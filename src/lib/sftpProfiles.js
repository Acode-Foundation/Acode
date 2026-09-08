import fsOperation from "fileSystem";
import Url from "utils/Url";

const PROFILE_PREFIX = "profile-";
const MIGRATION_MARKER = "sftpNativeProfileMigration";
const MIGRATION_VERSION = "2";
const MIGRATED_STORAGE_KEYS = [
	"storageList",
	"folders",
	"files",
	"recentFiles",
	"recentFolders",
	"fileBrowserState",
];
const REMOVE_VALUE = Symbol("remove-value");

export function getSftpProfileId(url) {
	if (!/^sftp:/i.test(url || "")) return null;
	try {
		const { hostname, username, password, query } = Url.decodeUrl(url);
		const hasLegacyCredentials =
			username || password || query?.keyFile || query?.passPhrase;
		return hostname?.startsWith(PROFILE_PREFIX) && !hasLegacyCredentials
			? hostname
			: null;
	} catch {
		return null;
	}
}

export function createSftpProfileUrl(profileId, pathname = "/") {
	return Url.formate({
		protocol: "sftp:",
		hostname: profileId,
		path: pathname || "/",
	});
}

function saveSftpProfile({
	profileId = null,
	hostname,
	port = 22,
	username,
	authType,
	password = "",
	keyFile = "",
	passPhrase = "",
}) {
	return new Promise((resolve, reject) => {
		sftp.saveProfile(
			profileId,
			hostname,
			Number.parseInt(port, 10) || 22,
			username,
			authType,
			password,
			keyFile,
			passPhrase,
			resolve,
			reject,
		);
	});
}

export function editSftpProfile({
	profileId = null,
	hostname = "",
	port = 22,
	username = "",
	authType = "password",
	password = "",
	keyFile = "",
	passPhrase = "",
} = {}) {
	return new Promise((resolve, reject) => {
		sftp.editProfile(
			profileId,
			hostname,
			Number.parseInt(port, 10) || 22,
			username,
			authType,
			password,
			keyFile,
			passPhrase,
			resolve,
			reject,
		);
	});
}

export function getSftpProfileInfo(profileId) {
	return new Promise((resolve, reject) => {
		sftp.getProfileInfo(profileId, resolve, reject);
	});
}

export function deleteSftpProfile(profileId) {
	return new Promise((resolve) => {
		sftp.deleteProfile(profileId, resolve, resolve);
	});
}

/**
 * Moves legacy credential-bearing SFTP URLs into encrypted native profiles.
 * Profiles that cannot be encrypted are removed before third-party plugins load.
 * Unsaved editor tabs keep their cache and are restored as local recovery tabs.
 */
export async function migrateLegacySftpProfiles() {
	if (localStorage.getItem(MIGRATION_MARKER) === MIGRATION_VERSION) {
		return { failures: [], removedReferences: 0, recoveredFiles: 0 };
	}

	const profileCache = new Map();
	const copiedKeys = new Set();
	const failures = [];
	let removedReferences = 0;
	let recoveredFiles = 0;

	for (const storageKey of MIGRATED_STORAGE_KEYS) {
		const raw = localStorage.getItem(storageKey);
		if (!raw || !/sftp:/i.test(raw)) continue;
		let value;
		let isJson = true;
		try {
			value = JSON.parse(raw);
		} catch {
			value = raw;
			isJson = false;
		}

		const migrated = await migrateValue(value, storageKey);
		if (migrated.changed) {
			if (migrated.value === REMOVE_VALUE) {
				localStorage.removeItem(storageKey);
			} else {
				localStorage.setItem(
					storageKey,
					isJson ? JSON.stringify(migrated.value) : migrated.value,
				);
			}
		}
	}

	for (const keyFile of copiedKeys) {
		if (!keyFile.startsWith(globalThis.DATA_STORAGE || "\0")) continue;
		try {
			await fsOperation(keyFile).delete();
		} catch (error) {
			console.warn("Could not remove migrated SFTP key copy", error);
		}
	}

	localStorage.setItem(MIGRATION_MARKER, MIGRATION_VERSION);
	return { failures, removedReferences, recoveredFiles };

	async function migrateValue(value, storageKey, folderProfileId = null) {
		if (typeof value === "string") return migrateUrl(value);
		if (Array.isArray(value)) {
			let changed = false;
			const next = [];
			for (const item of value) {
				const migrated = await migrateValue(item, storageKey, folderProfileId);
				changed ||= migrated.changed;
				if (migrated.value !== REMOVE_VALUE) next.push(migrated.value);
			}
			return { value: next, changed };
		}
		if (value && typeof value === "object") {
			let changed = false;
			const next = {};
			let recoverFile = false;
			let nestedFolderProfileId =
				storageKey === "folders"
					? getSftpProfileId(value.url) || folderProfileId
					: null;
			const entries = Object.entries(value);
			if (storageKey === "folders") {
				const urlIndex = entries.findIndex(([key]) => key === "url");
				if (urlIndex > 0) entries.unshift(entries.splice(urlIndex, 1)[0]);
			}
			for (const [key, item] of entries) {
				const migratedKey = await migrateUrl(key, folderProfileId);
				changed ||= migratedKey.changed;
				if (migratedKey.value === REMOVE_VALUE) continue;

				const migrated = await migrateValue(
					item,
					storageKey,
					nestedFolderProfileId,
				);
				changed ||= migrated.changed;
				if (migrated.value === REMOVE_VALUE) {
					if (key === "uri" && storageKey === "files" && value.isUnsaved) {
						recoverFile = true;
						continue;
					}
					if (key === "url" || key === "uri") {
						return { value: REMOVE_VALUE, changed: true };
					}
					continue;
				}
				if (storageKey === "folders" && key === "url") {
					nestedFolderProfileId =
						getSftpProfileId(migrated.value) || nestedFolderProfileId;
				}
				next[migratedKey.value] = migrated.value;
			}
			if (recoverFile) {
				next.uri = null;
				next.filename = `Recovered ${value.filename || "remote file"}`;
				next.isUnsaved = true;
				next.deletedFile = true;
				recoveredFiles++;
			}
			return { value: next, changed };
		}
		return { value, changed: false };
	}

	async function migrateUrl(value, preferredProfileId = null) {
		if (!/^sftp:/i.test(value) || getSftpProfileId(value)) {
			return { value, changed: false };
		}

		let credentials;
		try {
			credentials = Url.decodeUrl(value);
			const { username, password, hostname, pathname, port, query } =
				credentials;
			if (!hostname || !username) {
				throw new Error("The saved SFTP address is incomplete");
			}
			const keyFile = normalizeLegacyValue(query?.keyFile);
			const passPhrase = normalizeLegacyValue(query?.passPhrase);
			if (keyFile) copiedKeys.add(keyFile);
			if (preferredProfileId) {
				return {
					value: createSftpProfileUrl(preferredProfileId, pathname || "/"),
					changed: true,
				};
			}
			const authType = keyFile ? "key" : "password";
			const signature = JSON.stringify({
				hostname,
				port: port || 22,
				username,
				password: password || "",
				keyFile,
				passPhrase,
			});

			let cachedProfile = profileCache.get(signature);
			if (!cachedProfile) {
				try {
					const profileId = await saveSftpProfile({
						hostname,
						port: port || 22,
						username,
						authType,
						password: password || "",
						keyFile,
						passPhrase,
					});
					cachedProfile = { profileId };
				} catch (error) {
					cachedProfile = {
						error,
						failure: createFailure(error, credentials),
					};
					failures.push(cachedProfile.failure);
				}
				profileCache.set(signature, cachedProfile);
			}
			if (cachedProfile.error) {
				removedReferences++;
				return { value: REMOVE_VALUE, changed: true };
			}
			return {
				value: createSftpProfileUrl(cachedProfile.profileId, pathname || "/"),
				changed: true,
			};
		} catch (error) {
			console.warn("Could not migrate legacy SFTP URL", error);
			const failure = createFailure(error, credentials);
			failures.push(failure);
			removedReferences++;
			return { value: REMOVE_VALUE, changed: true };
		}
	}
}

function createFailure(error, credentials = {}) {
	credentials ||= {};
	const sensitiveValues = [
		credentials.password,
		credentials.query?.passPhrase,
		credentials.query?.keyFile,
	].filter(Boolean);
	return {
		hostname: credentials.hostname || "unknown host",
		username: credentials.username || "unknown user",
		message: sanitizeError(error, sensitiveValues),
	};
}

function sanitizeError(error, sensitiveValues) {
	let message = error?.message || String(error || "Unknown migration error");
	if (error?.cause) {
		const cause = error.cause?.message || String(error.cause);
		if (cause && !message.includes(cause)) message += `: ${cause}`;
	}
	message = message.replace(/sftp:\/\/[^\s"'<>]+/gi, "sftp://[redacted]");
	for (const value of sensitiveValues) {
		for (const secret of [String(value), encodeURIComponent(String(value))]) {
			if (secret) message = message.split(secret).join("[redacted]");
		}
	}
	return message;
}

function normalizeLegacyValue(value) {
	return value && value !== "undefined" && value !== "null" ? value : "";
}

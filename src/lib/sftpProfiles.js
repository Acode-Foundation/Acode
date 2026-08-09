import fsOperation from "fileSystem";
import Url from "utils/Url";

const PROFILE_PREFIX = "profile-";
const MIGRATION_MARKER = "sftpNativeProfileMigration";
const MIGRATION_VERSION = "1";
const MIGRATED_STORAGE_KEYS = [
	"storageList",
	"folders",
	"files",
	"recentFiles",
	"recentFolders",
	"fileBrowserState",
];

export function getSftpProfileId(url) {
	if (!/^sftp:/.test(url || "")) return null;
	const { hostname } = Url.decodeUrl(url);
	return hostname?.startsWith(PROFILE_PREFIX) ? hostname : null;
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
 * Migration fails closed before third-party plugins load if encryption is unavailable.
 */
export async function migrateLegacySftpProfiles() {
	if (localStorage.getItem(MIGRATION_MARKER) === MIGRATION_VERSION) return;

	const profileCache = new Map();
	const copiedKeys = new Set();
	let migrationError = null;

	for (const storageKey of MIGRATED_STORAGE_KEYS) {
		const raw = localStorage.getItem(storageKey);
		if (!raw) continue;
		let value;
		try {
			value = JSON.parse(raw);
		} catch {
			continue;
		}

		const migrated = await migrateValue(value);
		if (migrated.changed) {
			localStorage.setItem(storageKey, JSON.stringify(migrated.value));
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

	if (migrationError) {
		throw new Error(
			"SFTP credentials could not be moved to encrypted native storage",
			{ cause: migrationError },
		);
	}

	localStorage.setItem(MIGRATION_MARKER, MIGRATION_VERSION);

	async function migrateValue(value) {
		if (typeof value === "string") return migrateUrl(value);
		if (Array.isArray(value)) {
			let changed = false;
			const next = [];
			for (const item of value) {
				const migrated = await migrateValue(item);
				changed ||= migrated.changed;
				next.push(migrated.value);
			}
			return { value: next, changed };
		}
		if (value && typeof value === "object") {
			let changed = false;
			const next = {};
			for (const [key, item] of Object.entries(value)) {
				const migrated = await migrateValue(item);
				changed ||= migrated.changed;
				next[key] = migrated.value;
			}
			return { value: next, changed };
		}
		return { value, changed: false };
	}

	async function migrateUrl(value) {
		if (!/^sftp:/.test(value) || getSftpProfileId(value)) {
			return { value, changed: false };
		}

		try {
			const { username, password, hostname, pathname, port, query } =
				Url.decodeUrl(value);
			if (!hostname || !username) return { value, changed: false };
			const keyFile = normalizeLegacyValue(query?.keyFile);
			const passPhrase = normalizeLegacyValue(query?.passPhrase);
			const authType = keyFile ? "key" : "password";
			const signature = JSON.stringify({
				hostname,
				port: port || 22,
				username,
				password: password || "",
				keyFile,
				passPhrase,
			});

			let profileId = profileCache.get(signature);
			if (!profileId) {
				profileId = await saveSftpProfile({
					hostname,
					port: port || 22,
					username,
					authType,
					password: password || "",
					keyFile,
					passPhrase,
				});
				profileCache.set(signature, profileId);
				if (keyFile) copiedKeys.add(keyFile);
			}
			return {
				value: createSftpProfileUrl(profileId, pathname || "/"),
				changed: true,
			};
		} catch (error) {
			console.warn("Could not migrate legacy SFTP URL", error);
			migrationError ||= error;
			return { value, changed: false };
		}
	}
}

function normalizeLegacyValue(value) {
	return value && value !== "undefined" && value !== "null" ? value : "";
}

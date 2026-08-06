/**
 * Encrypted storage for remote-server secrets (FTP/SFTP passwords and key
 * passphrases).
 *
 * The saved-server list itself stays in `localStorage.storageList` so plugins
 * that read it keep working; only the secrets are moved out into the native
 * encrypted store, keyed by connection identity. Secrets are put back into the
 * URL at connect time. See #2561.
 */

const SECURE_KEY = "remoteCredentials";

/** @type {Record<string, {password?: string, passPhrase?: string}>} */
let cache = {};

/**
 * Connection identity used as the lookup key: protocol, user, host and port.
 * Deliberately excludes the path so every folder under a server shares one entry.
 * @param {string} url
 * @returns {string|null}
 */
function keyFor(url) {
	if (!url) return null;
	const m = /^([a-z0-9+.-]+:)\/\/([^@/]*@)?([^/:?#]+)(:(\d+))?/i.exec(url);
	if (!m) return null;
	const protocol = m[1].toLowerCase();
	const userinfo = (m[2] || "").replace(/@$/, "");
	const username = decodeURIComponent(userinfo.split(":")[0] || "");
	const host = m[3].toLowerCase();
	const port = m[5] || "";
	return `${protocol}//${username}@${host}${port ? ":" + port : ""}`;
}

/**
 * Remove `user:password@` credentials from a URL, keeping the username.
 * Used so URLs saved before the migration still prefix-match today's URLs.
 * @param {string} url
 * @returns {string}
 */
function stripPassword(url) {
	if (!url) return url;
	return url.replace(
		/^([a-z0-9+.-]+:\/\/)([^@/]*?):([^@/]*)@/i,
		(_, scheme, user) => `${scheme}${user}@`,
	);
}

/** Promisified bridge helpers — resolve to null instead of throwing. */
function secureGet(key) {
	return new Promise((resolve) => {
		try {
			window.system.secureGet(key, resolve, () => resolve(null));
		} catch (_) {
			resolve(null);
		}
	});
}

function secureSet(key, value) {
	return new Promise((resolve, reject) => {
		try {
			window.system.secureSet(key, value, resolve, reject);
		} catch (error) {
			reject(error);
		}
	});
}

/**
 * Load secrets into memory, and migrate any credentials still embedded in
 * `localStorage.storageList` from older versions.
 * Must be awaited during startup, before anything connects to a remote server.
 */
async function hydrate() {
	try {
		const stored = await secureGet(SECURE_KEY);
		cache = stored ? JSON.parse(stored) || {} : {};
	} catch (error) {
		cache = {};
		window.log?.("error", `secureCredentials: hydrate failed - ${error}`);
	}

	await migrateLegacy();
}

/**
 * One-time move of inline credentials out of `localStorage.storageList`.
 * The plaintext copy is only rewritten once the encrypted write is confirmed on
 * disk, so an interrupted migration can't lose a saved server.
 */
async function migrateLegacy() {
	let list;
	try {
		list = JSON.parse(localStorage.storageList || "[]");
	} catch (_) {
		return;
	}
	if (!Array.isArray(list) || !list.length) return;

	let changed = false;
	const pending = { ...cache };

	for (const entry of list) {
		const url = entry?.url;
		if (!url || !/^[a-z0-9+.-]+:\/\/[^@/]*:[^@/]*@/i.test(url)) continue;

		const key = keyFor(url);
		if (!key) continue;

		const password = decodeURIComponent(
			/^[a-z0-9+.-]+:\/\/[^@/]*?:([^@/]*)@/i.exec(url)?.[1] || "",
		);
		if (!password) continue;

		pending[key] = { ...(pending[key] || {}), password };
		entry.url = stripPassword(url);
		changed = true;
	}

	if (!changed) return;

	try {
		await secureSet(SECURE_KEY, JSON.stringify(pending));
		cache = pending;
		localStorage.storageList = JSON.stringify(list);
	} catch (error) {
		// Keep the legacy copy and retry on the next launch rather than lose it.
		window.log?.("error", `secureCredentials: migration failed - ${error}`);
	}
}

/**
 * Secrets for a connection, or null. Synchronous by design so the existing
 * synchronous `fromUrl` paths keep working.
 * @param {string} url
 */
function get(url) {
	const key = keyFor(url);
	return (key && cache[key]) || null;
}

/**
 * Persist secrets for a connection. Empty values remove the entry.
 * @param {string} url
 * @param {{password?: string, passPhrase?: string}} secrets
 */
async function set(url, secrets) {
	const key = keyFor(url);
	if (!key) return;

	const clean = {};
	if (secrets?.password) clean.password = secrets.password;
	if (secrets?.passPhrase) clean.passPhrase = secrets.passPhrase;

	const next = { ...cache };
	if (Object.keys(clean).length) next[key] = clean;
	else delete next[key];

	await secureSet(SECURE_KEY, JSON.stringify(next));
	cache = next;
}

/**
 * Drop stored secrets for a connection (used when a server is removed).
 * @param {string} url
 */
async function remove(url) {
	await set(url, {});
}

export default { hydrate, get, set, remove, stripPassword, keyFor };

/**
 * Secure persistence for the saved remote-storage list (FTP/SFTP servers).
 *
 * Keeps the list in a native, hardware-backed encrypted store (AES256-GCM, via
 * the `system.secure*` bridge) instead of localStorage. The in-memory shape is
 * unchanged, so callers behave the same; only the on-disk storage differs.
 *
 * Access is synchronous via an in-memory cache, hydrated once at startup by
 * `hydrate()` — which must be awaited early in onDeviceReady, before any UI
 * reads the list. See #2561.
 */

const SECURE_KEY = "storageList";
const LEGACY_KEY = "storageList"; // the old localStorage key

/** @type {Array|null} in-memory source of truth; null until hydrated */
let cache = null;

function parse(json) {
	try {
		const value = JSON.parse(json);
		return Array.isArray(value) ? value : [];
	} catch (_) {
		return [];
	}
}

/**
 * Load the list into memory, migrating any legacy plaintext localStorage copy
 * into the encrypted store first. Safe to call more than once.
 * @returns {Promise<void>}
 */
async function hydrate() {
	// 1. One-time migration: if a legacy plaintext list exists in localStorage,
	//    move it into the encrypted store, then remove the plaintext copy.
	const legacy = localStorage.getItem(LEGACY_KEY);
	if (legacy != null) {
		try {
			// Only drop the plaintext copy AFTER the encrypted write succeeds,
			// so a failure here never loses the user's saved servers.
			await window.system.secureSet(SECURE_KEY, legacy);
			localStorage.removeItem(LEGACY_KEY);
		} catch (error) {
			// Migration failed — keep the legacy copy and fall back to it this
			// session rather than lose data. Try again next launch.
			window.log?.("error", `secureStorageList migration failed: ${error}`);
			cache = parse(legacy);
			return;
		}
	}

	// 2. Load from the encrypted store.
	try {
		const stored = await window.system.secureGet(SECURE_KEY);
		cache = stored ? parse(stored) : [];
	} catch (error) {
		window.log?.("error", `secureStorageList hydrate failed: ${error}`);
		cache = [];
	}
}

/**
 * The saved remote-storage list (synchronous).
 * Falls back to a one-shot legacy read if called before hydrate() (defensive;
 * should not happen in normal boot order).
 * @returns {Array}
 */
function get() {
	if (cache == null) {
		const legacy = localStorage.getItem(LEGACY_KEY);
		return legacy != null ? parse(legacy) : [];
	}
	return cache;
}

/**
 * Persist the list. Updates the in-memory cache immediately and flushes to the
 * encrypted store. The returned promise resolves once the flush completes;
 * synchronous callers may ignore it (the cache is already updated).
 * @param {Array} list
 * @returns {Promise<void>}
 */
function set(list) {
	cache = Array.isArray(list) ? list : [];
	const json = JSON.stringify(cache);
	return window.system.secureSet(SECURE_KEY, json).catch((error) => {
		window.log?.("error", `secureStorageList save failed: ${error}`);
	});
}

export default { hydrate, get, set };

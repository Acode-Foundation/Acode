import Url from "./Url";

/**
 * Remote storage helpers, kept free of `localStorage` so they can be tested.
 * The callers in `helpers.js` read the storage list and hand it in.
 */

/**
 * Finds the saved remote storage (SFTP/FTP) that owns a url.
 *
 * Only remote storages are matched: a local folder should keep its own name,
 * and a SAF tree's name is already supplied by the system picker.
 *
 * @param {Array<{url?: string, uri?: string, name?: string, home?: string, storageType?: string, type?: string}>} storageList
 * @param {string} url
 * @returns {object|null} the matching entry, or null
 */
export function findRemoteStorageRoot(storageList, url) {
	if (!Array.isArray(storageList)) return null;

	const target = trimTrailingSlash(Url.parse(url || "").url);
	if (!target) return null;

	let match = null;
	let matchLength = -1;

	for (const storage of storageList) {
		if (!storage) continue;

		const storageUrl = Url.parse(storage.url || storage.uri || "").url;
		if (!storageUrl || !isRemoteStorage(storageUrl, storage)) continue;

		const base = trimTrailingSlash(storageUrl);
		if (!Url.isSameOrDescendant(target, base)) continue;

		// Longest match wins: a storage can itself be opened inside another.
		if (base.length > matchLength) {
			match = storage;
			matchLength = base.length;
		}
	}

	return match;
}

/**
 * Name to show for a folder opened in the explorer.
 *
 * Folders under a remote storage are labelled relative to it, so
 * `/home/tony/myapp` opened as "My server" reads "My server / myapp" instead
 * of repeating the login name that only happens to be the home directory's
 * basename (e.g. "tony"). Anything else keeps the supplied fallback.
 *
 * @param {Array} storageList
 * @param {string} url
 * @param {string} [fallback]
 * @returns {string}
 */
export function getStorageDisplayName(storageList, url, fallback) {
	const root = findRemoteStorageRoot(storageList, url);
	if (!root) return fallback || "";

	const base = root.name || fallback;
	const rootUrl = trimTrailingSlash(Url.parse(root.url || root.uri || "").url);
	const folderUrl = trimTrailingSlash(Url.parse(url || "").url);
	if (!rootUrl || !folderUrl) return fallback || "";
	if (rootUrl === folderUrl) return base;

	// A storage remembers the directory it was added from. That directory is
	// the storage as far as the reader is concerned, so paths below it are
	// shown relative to it rather than repeating "home/tony".
	const homeUrl = root.home ? joinUrl(rootUrl, root.home) : null;
	if (homeUrl && folderUrl === homeUrl) return base;
	if (homeUrl && folderUrl.startsWith(`${homeUrl}/`)) {
		return `${base} / ${folderUrl.slice(homeUrl.length + 1)}`;
	}

	if (!folderUrl.startsWith(`${rootUrl}/`)) return fallback || "";
	const relative = folderUrl.slice(rootUrl.length + 1);
	return relative ? `${base} / ${relative}` : base;
}

function isRemoteStorage(storageUrl, storage = {}) {
	if (/^(ftp|sftp):/i.test(storageUrl)) return true;
	const declared = storage.storageType || storage.type || "";
	return /^(ftp|sftp)$/i.test(declared);
}

function trimTrailingSlash(value = "") {
	return String(value).replace(/\/$/, "");
}

/**
 * Appends a path to a url without touching the scheme's `//`.
 * @param {string} baseUrl
 * @param {string} segment
 */
function joinUrl(baseUrl, segment) {
	const clean = String(segment || "")
		.replace(/^\/+/, "")
		.replace(/\/+$/, "");
	return clean ? `${baseUrl}/${clean}` : baseUrl;
}

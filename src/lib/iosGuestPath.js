const ALPINE_URL = "alpine://localhost";
const FILE_URL = "file://";

/**
 * Path inside iOS Alpine for a folder URL. Internal filesystem URLs are
 * already decoded, so literal `#` and `%` must survive as-is; only Alpine URLs
 * carry percent-encoding, one level per segment.
 * @param {string} url
 * @returns {string}
 */
export default function iosGuestPath(url = "") {
	if (url.startsWith(ALPINE_URL)) {
		const path = url.slice(ALPINE_URL.length);
		return path.split("/").map(decodeURIComponent).join("/") || "/";
	}
	const path = url.startsWith(FILE_URL) ? url.slice(FILE_URL.length) : url;
	const publicPath = `${nativeDirectoryPath(Bridge.file.dataDirectory)}public`;
	if (path === publicPath || path.startsWith(`${publicPath}/`)) {
		return `/public${path.slice(publicPath.length)}`;
	}
	return path;
}

/** Native directory URLs are encoded absolute strings, unlike listings. */
function nativeDirectoryPath(url) {
	return decodeURIComponent(url.slice(FILE_URL.length));
}

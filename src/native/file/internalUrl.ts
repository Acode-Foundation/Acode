import type { FileSystem } from "./entries";

// Paths outside this set (encoded, unicode, special characters) could be
// normalised differently by Android, so they are left to the native resolver.
const SAFE_PATH = /^file:\/\/\/[\w\-.~ /]*$/;

/**
 * Formats the WebView URL of an Android `file://` path the same way the native
 * `resolveLocalFileSystemURI` does, without a bridge round trip: the matching
 * filesystem with the shortest local URL wins and directories end with `/`.
 * Returns null whenever the result could differ from native, so callers fall
 * back to it. iOS resolves symlinks and remapped containers natively, so it
 * always uses the native path.
 */
export default function toInternalURL(
	fileSystems: Map<string, FileSystem>,
	url: string,
	isDirectory = false,
): string | null {
	if (Bridge.platformId !== "android" || !fileSystems.size) return null;
	if (typeof url !== "string" || !SAFE_PATH.test(url)) return null;

	const path = url.slice("file://".length);
	if (/\/\/|\/\.\.?(\/|$)/.test(path)) return null;

	let best: { fs: FileSystem; fullPath: string; length: number } | null = null;
	for (const fs of fileSystems.values()) {
		const rootURL = fs.root.nativeURL;
		if (!rootURL?.startsWith("file:///")) continue;
		const root = rootURL.slice("file://".length).replace(/\/$/, "");
		if (!path.startsWith(root)) continue;
		const rest = path.slice(root.length);
		// Native accepts a root that is only a string prefix (e.g. ".../files"
		// for ".../files-x"); that case is too unusual to replicate.
		if (rest && !rest.startsWith("/")) return null;
		let fullPath = rest.replace(/\/$/, "") || "/";
		if (isDirectory && !fullPath.endsWith("/")) fullPath += "/";
		const length = `cdvfile://localhost/${fs.name}${fullPath}`.length;
		if (!best || length < best.length) best = { fs, fullPath, length };
	}
	return best ? best.fs.format(best.fullPath, url) : null;
}

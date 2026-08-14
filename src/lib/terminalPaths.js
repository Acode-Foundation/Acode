import Path from "utils/Path";
import Uri from "utils/Uri";

const DEFAULT_PACKAGE_NAME = "com.foxdebug.acode";

function trimTrailingSlash(path) {
	return path === "/" ? path : path.replace(/\/+$/, "");
}

function stripFileScheme(value = "") {
	return trimTrailingSlash(String(value).replace(/^file:\/\//, ""));
}

function isWithinPath(path, root) {
	return path === root || path.startsWith(`${root}/`);
}

function replacePathRoot(path, root, replacement) {
	if (!isWithinPath(path, root)) return null;
	const relative = path.slice(root.length).replace(/^\/+/, "");
	return relative ? Path.join(replacement, relative) : replacement;
}

export function getTerminalPaths(options = {}) {
	const packageName =
		options.packageName ||
		globalThis.BuildInfo?.packageName ||
		DEFAULT_PACKAGE_NAME;
	const filesDir = options.filesDir || `/data/user/0/${packageName}/files`;
	const alpineRoot = `${trimTrailingSlash(filesDir)}/alpine`;

	return {
		packageName,
		filesDir: trimTrailingSlash(filesDir),
		alpineRoot,
		publicDir: `${trimTrailingSlash(filesDir)}/public`,
		legacyHomeDir: `${alpineRoot}/home`,
		legacyRootDir: `${alpineRoot}/root`,
	};
}

export function isAcodeTerminalSafUri(value = "", options = {}) {
	const { packageName } = getTerminalPaths(options);
	const authority = `${packageName}.documents`;
	return (
		String(value).startsWith(`content://${authority}/`) ||
		/^content:\/\/com\.foxdebug\.acode(?:\.[a-z0-9_.-]+)?\.documents\//i.test(
			String(value),
		)
	);
}

function getSafDocumentPath(url, options) {
	if (!isAcodeTerminalSafUri(url, options)) return null;

	try {
		let { docId } = Uri.parse(url);
		if (/::/.test(url)) docId = decodeURIComponent(docId || "");
		if (!docId) return "";
		return stripFileScheme(docId);
	} catch (error) {
		console.warn(`Failed to parse terminal SAF URI: ${url}`, error);
		return null;
	}
}

/**
 * Convert an app-visible terminal URL into its path inside PRoot.
 * Returns null for paths that are not owned by the terminal sandbox.
 */
export function terminalUrlToProotPath(url = "", options = {}) {
	const paths = getTerminalPaths(options);
	const safPath = getSafDocumentPath(url, options);
	let physicalPath = safPath === null ? stripFileScheme(url) : safPath;

	// Compatibility with older provider IDs that used public:relative/path.
	if (physicalPath.startsWith("public:")) {
		const relative = physicalPath.slice("public:".length).replace(/^\/+/, "");
		return relative ? Path.join("/public", relative) : "/public";
	}
	if (physicalPath === "/public" || physicalPath.startsWith("/public/")) {
		return physicalPath;
	}

	return (
		replacePathRoot(physicalPath, paths.publicDir, "/public") ??
		replacePathRoot(physicalPath, paths.legacyHomeDir, "/legacy-home") ??
		replacePathRoot(physicalPath, paths.legacyRootDir, "/legacy-root") ??
		replacePathRoot(physicalPath, paths.alpineRoot, "/")
	);
}

export function isTerminalAccessibleUrl(url = "", options = {}) {
	return terminalUrlToProotPath(url, options) !== null;
}

/** Convert a PRoot path emitted by the terminal into an app file URL. */
export function prootPathToTerminalUrl(prootPath = "", options = {}) {
	if (!prootPath) return prootPath;
	if (!String(prootPath).startsWith("/")) return prootPath;

	const paths = getTerminalPaths(options);
	const directAndroidRoots = ["/sdcard", "/storage", "/data"];
	if (directAndroidRoots.some((root) => isWithinPath(prootPath, root))) {
		return `file://${prootPath}`;
	}

	const mappings = [
		["/legacy-home", paths.legacyHomeDir],
		["/legacy-root", paths.legacyRootDir],
		["/public", paths.publicDir],
		["/home", paths.publicDir],
		["/root", paths.publicDir],
	];
	for (const [root, physicalRoot] of mappings) {
		const converted = replacePathRoot(prootPath, root, physicalRoot);
		if (converted !== null) return `file://${converted}`;
	}

	const relative = prootPath.replace(/^\/+/, "");
	return `file://${relative ? Path.join(paths.alpineRoot, relative) : paths.alpineRoot}`;
}

export { isWithinPath };

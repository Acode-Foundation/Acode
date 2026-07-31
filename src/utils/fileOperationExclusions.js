import picomatch from "picomatch/posix";
import Url from "utils/Url";

/**
 * Test whether a file-system URL matches one of the configured exclusion globs.
 * Both the URL path and a directory-style version are checked so recursive
 * glob patterns also match the excluded directory itself.
 *
 * @param {string} url
 * @param {string[]} patterns
 * @returns {boolean}
 */
export function isExcludedFileOperationPath(url, patterns = []) {
	if (!url || !Array.isArray(patterns) || !patterns.length) return false;

	const parsedUrl = Url.parse(url).url;
	const pathname = Url.pathname(parsedUrl) || parsedUrl;
	const normalizedPath = pathname.replace(/\\/g, "/").replace(/\/+$/, "");
	const relativePath = normalizedPath.replace(/^\/+/, "");
	const candidates = [
		normalizedPath,
		`${normalizedPath}/`,
		relativePath,
		`${relativePath}/`,
	];

	return patterns.some((pattern) => {
		if (typeof pattern !== "string" || !pattern.trim()) return false;

		try {
			return candidates.some((candidate) =>
				picomatch.isMatch(candidate, pattern.trim(), {
					matchBase: !pattern.includes("/") && !pattern.includes("\\"),
				}),
			);
		} catch (error) {
			console.warn(`Invalid file exclusion pattern: ${pattern}`, error);
			return false;
		}
	});
}

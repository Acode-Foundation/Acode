import fsOperation from "fileSystem";
import { isExcludedFileOperationPath } from "./fileOperationExclusions";
import Url from "./Url";

/**
 * Recursively copy a file or directory while omitting excluded entries.
 *
 * @param {string} sourceUrl
 * @param {string} targetDirUrl
 * @param {object} [options]
 * @param {string} [options.name]
 * @param {object} [options.stat]
 * @param {string[]} [options.excludePatterns]
 * @returns {Promise<{url: string|null, copied: number, skipped: number}>}
 */
export default async function copyEntry(
	sourceUrl,
	targetDirUrl,
	{ name, stat: sourceStat, excludePatterns = [] } = {},
) {
	if (isExcludedFileOperationPath(sourceUrl, excludePatterns)) {
		return { url: null, copied: 0, skipped: 1 };
	}

	const sourceFs = fsOperation(sourceUrl);
	const stat = sourceStat || (await sourceFs.stat());
	const entryName = name || stat.name || Url.basename(sourceUrl);

	if (!stat.isDirectory) {
		const content = await sourceFs.readFile();
		const url = await fsOperation(targetDirUrl).createFile(entryName, content);
		return { url, copied: 1, skipped: 0 };
	}

	const url = await fsOperation(targetDirUrl).createDirectory(entryName);
	const result = { url, copied: 1, skipped: 0 };
	const entries = await sourceFs.lsDir();

	for (const entry of entries) {
		const child = await copyEntry(entry.url, url, {
			name: entry.name || Url.basename(entry.url),
			stat: entry,
			excludePatterns,
		});
		result.copied += child.copied;
		result.skipped += child.skipped;
	}

	return result;
}

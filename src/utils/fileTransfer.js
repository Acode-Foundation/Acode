import fsOperation from "fileSystem";
import copyEntry from "./copyEntry";
import Url from "./Url";

export function shouldUseRecursiveTransfer(sourceUrl, targetDirUrl) {
	return Url.getProtocol(sourceUrl) !== Url.getProtocol(targetDirUrl);
}

/**
 * Transfer an entry, falling back to an API-neutral recursive copy whenever
 * the source and destination use different filesystem implementations.
 * Cross-filesystem moves delete the source only after the full copy succeeds.
 */
export default async function transferEntry(
	sourceUrl,
	targetDirUrl,
	{ operation = "copy", forceRecursive = false, excludePatterns = [] } = {},
) {
	const sourceFs = fsOperation(sourceUrl);
	const recursive =
		forceRecursive ||
		excludePatterns.length > 0 ||
		shouldUseRecursiveTransfer(sourceUrl, targetDirUrl);

	if (!recursive) {
		const url =
			await sourceFs[operation === "move" ? "moveTo" : "copyTo"](targetDirUrl);
		return { url, copied: null, skipped: 0, recursive: false };
	}

	const result = await copyEntry(sourceUrl, targetDirUrl, { excludePatterns });
	if (operation === "move" && result.url) {
		if (result.skipped > 0) {
			throw new Error(
				"Move copy was incomplete; the source was preserved for recovery.",
			);
		}
		await sourceFs.delete();
	}

	return { ...result, recursive: true };
}

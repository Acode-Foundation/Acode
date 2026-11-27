/**
 * Formats a download progress label.
 *
 * Falls back to the plain loading label when the total size is unknown
 * (e.g. a chunked response without `Content-Length`), avoiding values like
 * "Infinity%" or "NaN%".
 *
 * @param {number} loaded bytes received
 * @param {number} total total bytes, or 0/undefined when unknown
 * @param {string} [label] loading label, defaults to `strings.loading`
 * @returns {string}
 */
export default function formatDownloadProgress(loaded, total, label) {
	const loading = label ?? globalThis.strings?.loading ?? "Loading";
	if (!Number.isFinite(total) || total <= 0) return loading;
	const percent = Math.min(100, (loaded / total) * 100).toFixed(2);
	return `${loading} ${percent}%`;
}

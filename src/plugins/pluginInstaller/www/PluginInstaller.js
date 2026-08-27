var exec = require("cordova/exec");

let nextRequestId = 0;

/**
 * Extracts a plugin zip archive into a destination directory using native
 * (Java) file I/O running on Cordova's background thread pool.
 *
 * This replaces the old JS-side extraction loop, which processed zip
 * entries in hardcoded batches of 2 (with a `setTimeout` "breather" in
 * between) just to keep the WebView UI thread from freezing. Because the
 * native side never touches the UI thread, no such batching is needed here.
 *
 * `zipPath` should point to an already-downloaded copy of the archive on
 * disk (e.g. a temp file under CACHE_STORAGE) rather than being passed as a
 * base64 string - streaming straight from a file avoids inflating the
 * payload by ~33% and holding several full copies of it in memory across
 * the JS/bridge/Java boundary.
 *
 * The returned promise has a `.cancel()` method: calling it asks the native
 * side to stop as soon as it next checks (between entries, or mid-read for
 * a large single file), which rejects the promise with an `Error` whose
 * `cancelled` property is `true`. Calling `.cancel()` after the promise has
 * already settled is a no-op.
 *
 * @param {string} zipPath Path (or `file://` URI) of the already-downloaded
 *  zip archive on disk.
 * @param {string} destDirUri Destination directory, as a `file://` URI (or
 *  a plain absolute path) - typically the plugin's install directory.
 * @param {string | null} [pluginJsonOverride] When provided, this exact
 *  string is written for the archive's top-level `plugin.json` entry
 *  instead of its original contents (used for the JS side's patched
 *  manifest: resolved `main`/`icon`/`readme`, `source`, etc).
 * @param {Record<string, string>} [existingState] Map of
 *  `lowercased relative path -> sha256 hex checksum` from the previous
 *  install, used to skip rewriting files that haven't changed.
 * @param {(done: number, total: number) => void} [onProgress] Optional
 *  callback invoked as entries are processed, e.g. to update a loader
 *  message ("Extracting 42%").
 * @returns {Promise<{ store: Record<string, string>, skippedUnsafe: string[], failed: string[] }> & { cancel(): void }}
 *  `store` is the full checksum map (one entry per archive file) to persist
 *  as the new install state. `skippedUnsafe` lists archive entries ignored
 *  because they resolved to an unsafe (absolute/traversal) path. `failed`
 *  lists entries that could not be read or written (oversized, I/O error,
 *  etc) - extraction continues past these rather than aborting.
 */
function extractZip(
	zipPath,
	destDirUri,
	pluginJsonOverride,
	existingState,
	onProgress,
) {
	const requestId = `plugin-install-${Date.now()}-${nextRequestId++}`;
	let settled = false;

	const promise = new Promise((resolve, reject) => {
		exec(
			(result) => {
				if (result && result.type === "progress") {
					if (onProgress) onProgress(result.done, result.total);
					return; // native side keeps the callback open until the final result
				}
				settled = true;
				resolve(result);
			},
			(error) => {
				settled = true;
				if (error === "CANCELLED") {
					const cancelError = new Error("Extraction cancelled");
					cancelError.cancelled = true;
					reject(cancelError);
					return;
				}
				reject(error);
			},
			"PluginInstaller",
			"extractZip",
			[requestId, zipPath, destDirUri, pluginJsonOverride || null, existingState || {}],
		);
	});

	promise.cancel = () => {
		if (settled) return;
		cancelExtract(requestId).catch(() => {});
	};

	return promise;
}

/**
 * Asks a previously-started `extractZip` call to stop. This only signals
 * the request; the `extractZip` promise itself is what actually rejects
 * (with `{ cancelled: true }`) once the native side notices and unwinds.
 * Prefer calling `.cancel()` on the promise returned by `extractZip` rather
 * than calling this directly.
 *
 * @param {string} requestId
 * @returns {Promise<void>}
 */
function cancelExtract(requestId) {
	return new Promise((resolve, reject) => {
		exec(resolve, reject, "PluginInstaller", "cancelExtract", [requestId]);
	});
}

module.exports = {
	extractZip,
	cancelExtract,
};
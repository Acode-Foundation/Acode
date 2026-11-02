/**
 * Helpers shared by the remote filesystem providers.
 *
 * A remote read can fail in ways that look like an empty file: the channel
 * drops, the cached copy is truncated by the next download, or the plug-in
 * reports success without writing anything. Reporting an empty document as
 * file content is dangerous, because the save path treats it as the real
 * contents and can replace the person's work with it. These functions let the
 * providers tell the two apart.
 */

/**
 * Error used when a download did not produce the bytes the server reported.
 * @param {string} message
 * @returns {Error}
 */
export function incompleteDownloadError(message) {
	return Object.assign(new Error(message), {
		code: "INCOMPLETE_DOWNLOAD",
		// Retrying cannot help; the caller must not treat this as "empty file".
		nonRetryable: true,
	});
}

/**
 * Throws when a downloaded buffer is shorter than the size the server reported.
 *
 * An empty result is rejected whenever the server expects a non-empty file,
 * which is the case that turned a dropped connection into an empty document.
 * Encoding size differs from byte size, so callers pass raw bytes.
 *
 * @param {ArrayBuffer|Uint8Array|{byteLength?: number, length?: number}|null} data
 * @param {number} expectedLength size in bytes, or 0 when unknown
 * @param {string} [name] file name, for the message
 * @returns {void}
 */
export function assertDownloadIsComplete(data, expectedLength, name = "file") {
	const expected = Number(expectedLength);
	if (!Number.isFinite(expected) || expected <= 0) return;

	const received = byteLengthOf(data);
	if (received >= expected) return;

	throw incompleteDownloadError(
		`"${name}" was not downloaded completely (${received} of ${expected} bytes). ` +
			"The file was left untouched.",
	);
}

/**
 * Byte length of the shapes a download can produce.
 * @param {ArrayBuffer|Uint8Array|{byteLength?: number, length?: number}|null} data
 * @returns {number}
 */
export function byteLengthOf(data) {
	if (data == null) return 0;
	if (typeof data.byteLength === "number") return data.byteLength;
	if (typeof data.length === "number") return data.length;
	return 0;
}

/**
 * Whether a native error means the remote file is gone.
 *
 * Used to keep "the file was deleted" distinct from "the server could not be
 * reached": only the former justifies treating the content as unknown.
 * @param {unknown} error
 * @returns {boolean}
 */
export function isMissingFileError(error) {
	const message = errorMessageOf(error);
	return /no such file|not found|ENOENT|NoSuchFile|does not exist/i.test(
		message,
	);
}

/**
 * Reads the text of an error whatever shape the native layer used: a string, an
 * Error, or a rejected payload carrying `message`/`code`.
 * @param {unknown} error
 * @returns {string}
 */
export function errorMessageOf(error) {
	if (!error) return "";
	if (typeof error === "string") return error;
	if (typeof error === "object") {
		const { message, code } = error;
		return [code, message].filter(Boolean).join(": ") || String(error);
	}
	return String(error);
}

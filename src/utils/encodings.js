import alert from "dialogs/alert";
import settings from "lib/settings";

let encodings = {};

/**
 * @typedef {Object} Encoding
 * @property {string} label
 * @property {string[]} aliases
 * @property {string} name
 */

/**
 * Get the encoding label from the charset
 * @param {string} charset
 * @returns {Encoding|undefined}
 */
export function getEncoding(charset) {
	charset = charset.toLowerCase();

	const found = Object.keys(encodings).find((key) => {
		if (key.toLowerCase() === charset) {
			return true;
		}

		const alias = encodings[key].aliases.find(
			(alias) => alias.toLowerCase() === charset,
		);
		if (alias) {
			return true;
		}

		return false;
	});

	if (found) {
		return encodings[found];
	}

	return encodings["UTF-8"];
}

function detectBOM(bytes) {
	if (
		bytes.length >= 3 &&
		bytes[0] === 0xef &&
		bytes[1] === 0xbb &&
		bytes[2] === 0xbf
	)
		return "UTF-8";
	if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe)
		return "UTF-16LE";
	if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff)
		return "UTF-16BE";
	return null;
}

export async function detectEncoding(buffer) {
	if (!buffer || buffer.byteLength === 0) {
		return settings.value.defaultFileEncoding || "UTF-8";
	}

	const bytes = new Uint8Array(buffer);

	const bomEncoding = detectBOM(bytes);
	if (bomEncoding) return bomEncoding;

	const sample = bytes.subarray(0, Math.min(2048, bytes.length));
	let nulls = 0,
		ascii = 0;

	for (const byte of sample) {
		if (byte === 0) nulls++;
		else if (byte < 0x80) ascii++;
	}

	if (ascii / sample.length > 0.95) return "UTF-8";
	if (nulls > sample.length * 0.3) return "UTF-16LE";

	const encodings = [
		...new Set([
			"UTF-8",
			settings.value.defaultFileEncoding || "UTF-8",
			"windows-1252",
			"ISO-8859-1",
		]),
	];

	const testSample = sample.subarray(0, 512);
	const testBuffer = testSample.buffer.slice(
		testSample.byteOffset,
		testSample.byteOffset + testSample.byteLength,
	);

	for (const encoding of encodings) {
		try {
			const encodingObj = getEncoding(encoding);
			if (!encodingObj) continue;

			const text = await execDecode(testBuffer, encodingObj.name);
			if (
				!text.includes("\uFFFD") &&
				!/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(text)
			) {
				return encoding;
			}
		} catch (error) {
			continue;
		}
	}

	return settings.value.defaultFileEncoding || "UTF-8";
}

/**
 * Decodes arrayBuffer to String according given encoding type
 * @param {ArrayBuffer} buffer
 * @param {string} [charset]
 * @returns {Promise<string>}
 */
export async function decode(buffer, charset) {
	let isJson = false;

	if (charset === "json") {
		charset = null;
		isJson = true;
	}

	if (!charset) {
		charset = settings.value.defaultFileEncoding;
	}

	charset = getEncoding(charset).name;
	const text = await execDecode(buffer, charset);

	if (isJson) {
		return JSON.parse(text);
	}

	return text;
}

/**
 * Encodes text to ArrayBuffer according given encoding type
 * @param {string} text
 * @param {string} charset
 * @returns {Promise<ArrayBuffer>}
 */
export function encode(text, charset) {
	if (!charset) {
		charset = settings.value.defaultFileEncoding;
	}

	charset = getEncoding(charset).name;
	return execEncode(text, charset);
}

export async function initEncodings() {
	return new Promise((resolve, reject) => {
		cordova.exec(
			(map) => {
				Object.keys(map).forEach((key) => {
					const encoding = map[key];
					encodings[key] = encoding;
				});
				resolve();
			},
			(error) => {
				alert(strings.error, error.message || error);
				reject(error);
			},
			"System",
			"get-available-encodings",
			[],
		);
	});
}

/**
 * Decodes arrayBuffer to String according given encoding type
 * @param {ArrayBuffer} buffer
 * @param {string} charset
 * @returns {Promise<string>}
 */
function execDecode(buffer, charset) {
	return new Promise((resolve, reject) => {
		cordova.exec(
			(text) => {
				resolve(text);
			},
			(error) => {
				reject(error);
			},
			"System",
			"decode",
			[buffer, charset],
		);
	});
}

/**
 * Encodes text to ArrayBuffer according given encoding type
 * @param {string} text
 * @param {string} charset
 * @returns {Promise<ArrayBuffer>}
 */
function execEncode(text, charset) {
	return new Promise((resolve, reject) => {
		cordova.exec(
			(buffer) => {
				resolve(buffer);
			},
			(error) => {
				reject(error);
			},
			"System",
			"encode",
			[text, charset],
		);
	});
}

export default encodings;

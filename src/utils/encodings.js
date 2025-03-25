import alert from "dialogs/alert";
import settings from "lib/settings";

const encodings = {};

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

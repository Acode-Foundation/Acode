import alert from "dialogs/alert";
import platform from "lib/platform";
import settings from "lib/settings";

let encodings = {};

/**
 * Sending text through the native bridge base64-encodes it twice (about 0.8 s
 * for a 3.7 MB file on a mid-range phone), while the WebView decodes UTF-8 in
 * milliseconds. Only input the native decoder would treat identically is
 * handled here: Android keeps a UTF-8 BOM and iOS strips it, and invalid bytes
 * or lone surrogates still go to native so their replacement/error behaviour
 * is unchanged.
 */
const UTF8 = "UTF-8";
const LONE_SURROGATE =
	/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
let utf8Decoder;
let utf8Encoder;

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

function isValidUTF8(bytes) {
	let i = 0;
	while (i < bytes.length) {
		const byte = bytes[i];

		if (byte < 0x80) {
			i++;
		} else if (byte >> 5 === 0x06) {
			if (i + 1 >= bytes.length || bytes[i + 1] >> 6 !== 0x02) return false;
			i += 2;
		} else if (byte >> 4 === 0x0e) {
			if (
				i + 2 >= bytes.length ||
				bytes[i + 1] >> 6 !== 0x02 ||
				bytes[i + 2] >> 6 !== 0x02
			)
				return false;
			i += 3;
		} else if (byte >> 3 === 0x1e) {
			if (
				i + 3 >= bytes.length ||
				bytes[i + 1] >> 6 !== 0x02 ||
				bytes[i + 2] >> 6 !== 0x02 ||
				bytes[i + 3] >> 6 !== 0x02
			)
				return false;
			i += 4;
		} else {
			return false;
		}
	}
	return true;
}

export async function detectEncoding(buffer) {
	if (!buffer || buffer.byteLength === 0) {
		const def = settings.value.defaultFileEncoding;
		return def === "auto" ? "UTF-8" : def || "UTF-8";
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

	if (nulls > sample.length * 0.3) return "UTF-16LE";

	if (isValidUTF8(sample)) return "UTF-8";

	const encodings = [
		...new Set([
			"UTF-8",
			settings.value.defaultFileEncoding === "auto"
				? "UTF-8"
				: settings.value.defaultFileEncoding || "UTF-8",
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

	const def = settings.value.defaultFileEncoding;
	return def === "auto" ? "UTF-8" : def || "UTF-8";
}

/**
 * Resolves a charset string to the canonical encoding name.
 * @param {string} charset
 * @returns {string}
 */
export function getEncodingName(charset) {
	if (!charset) {
		charset = settings.value.defaultFileEncoding;
	}

	if (charset === "auto") charset = "UTF-8";

	return getEncoding(charset).name;
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

	charset = getEncodingName(charset);
	const text =
		(charset === UTF8 ? decodeUtf8(buffer) : null) ??
		(await execDecode(buffer, charset));

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
export async function encode(text, charset) {
	charset = getEncodingName(charset);
	if (charset === UTF8 && !LONE_SURROGATE.test(text)) {
		utf8Encoder ??= new TextEncoder();
		const bytes = utf8Encoder.encode(text);
		// The bridge sends whole ArrayBuffers, so pass one sized to the text.
		return bytes.byteLength === bytes.buffer.byteLength
			? bytes.buffer
			: bytes.slice().buffer;
	}
	return execEncode(text, charset);
}

const ENCODINGS_CACHE_KEY = "availableEncodingsCache";

export async function initEncodings() {
	const cachedMap = readCachedEncodings();
	if (cachedMap) {
		setEncodings(cachedMap);
		return;
	}

	return new Promise((resolve, reject) => {
		Bridge.exec(
			(map) => {
				setEncodings(map);
				writeCachedEncodings(map);
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
		Bridge.exec(
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
		Bridge.exec(
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

/**
 * The available charsets only change with the native runtime, so the list is
 * cached per app build and OS version instead of being rebuilt natively (and
 * sent over the bridge) on every launch.
 */
function getEncodingsCacheId() {
	return [
		globalThis.BuildInfo?.versionCode,
		globalThis.device?.platform,
		globalThis.device?.version,
		globalThis.device?.model,
	].join("|");
}

function setEncodings(map) {
	Object.keys(map).forEach((key) => {
		const encoding = map[key];
		encodings[key] = encoding;
	});
}

function readCachedEncodings() {
	try {
		const cached = JSON.parse(localStorage.getItem(ENCODINGS_CACHE_KEY));
		if (cached?.id !== getEncodingsCacheId()) return null;
		const { map } = cached;
		if (!map || typeof map !== "object" || !map["UTF-8"]) return null;
		return map;
	} catch {
		return null;
	}
}

function writeCachedEncodings(map) {
	try {
		localStorage.setItem(
			ENCODINGS_CACHE_KEY,
			JSON.stringify({ id: getEncodingsCacheId(), map }),
		);
	} catch (error) {
		console.warn("Unable to cache available encodings", error);
	}
}

/**
 * @param {ArrayBuffer} buffer
 * @returns {string|null} null when the bytes are not valid UTF-8
 */
function decodeUtf8(buffer) {
	try {
		utf8Decoder ??= new TextDecoder(UTF8, {
			fatal: true,
			ignoreBOM: !platform.isIOS,
		});
		return utf8Decoder.decode(buffer);
	} catch {
		return null;
	}
}

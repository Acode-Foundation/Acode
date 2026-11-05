export const binaryExtensions = [
	"3gp",
	"3g2",
	"3mf",
	"7z",
	"aab",
	"aac",
	"ac3",
	"ace",
	"aif",
	"ai",
	"alias",
	"amr",
	"ape",
	"apk",
	"app",
	"apng",
	"ar",
	"arj",
	"arrow",
	"arw",
	"asar",
	"avi",
	"avif",
	"bin",
	"blend",
	"bmp",
	"bpg",
	"bz2",
	"cab",
	"cfb",
	"chm",
	"class",
	"cpio",
	"cr2",
	"cr3",
	"crx",
	"cur",
	"dat",
	"dcm",
	"db",
	"db3",
	"dds",
	"deb",
	"der",
	"dex",
	"dll",
	"dmg",
	"dng",
	"doc",
	"docm",
	"docx",
	"dotm",
	"dotx",
	"drc",
	"dsf",
	"dwg",
	"dylib",
	"eot",
	"epub",
	"eps",
	"exe",
	"f4a",
	"f4b",
	"f4p",
	"f4v",
	"fbx",
	"flac",
	"flif",
	"flv",
	"gif",
	"glb",
	"gz",
	"heic",
	"heif",
	"icc",
	"icns",
	"ico",
	"img",
	"indd",
	"iso",
	"it",
	"jar",
	"jls",
	"jp2",
	"jpm",
	"jpeg",
	"jpg",
	"jpx",
	"jxr",
	"jks",
	"key",
	"keystore",
	"ktx",
	"lnk",
	"lz",
	"lz4",
	"lzh",
	"m4a",
	"m4b",
	"m4p",
	"m4v",
	"macho",
	"mid",
	"mie",
	"mj2",
	"mkv",
	"mobi",
	"mov",
	"mp1",
	"mp2",
	"mp3",
	"mp4",
	"mpc",
	"mpg",
	"msi",
	"mts",
	"mxf",
	"nef",
	"nes",
	"numbers",
	"o",
	"odp",
	"ods",
	"odt",
	"oga",
	"ogg",
	"ogm",
	"ogv",
	"ogx",
	"orf",
	"otp",
	"ots",
	"ott",
	"otf",
	"p12",
	"pages",
	"parquet",
	"pdf",
	"pfx",
	"pgp",
	"png",
	"potm",
	"potx",
	"ppsx",
	"ppsm",
	"pptm",
	"pptx",
	"ps",
	"psd",
	"pst",
	"pyc",
	"qcp",
	"raf",
	"rar",
	"realm",
	"rm",
	"rpm",
	"rootfs",
	"rw2",
	"s3m",
	"sav",
	"sketch",
	"skp",
	"squashfs",
	"spx",
	"so",
	"sqlite",
	"sqlite3",
	"stl",
	"swf",
	"tar",
	"tar.gz",
	"tga",
	"tgz",
	"tif",
	"tiff",
	"ttc",
	"ttf",
	"voc",
	"vsdx",
	"war",
	"wasm",
	"wav",
	"webm",
	"webp",
	"wmv",
	"woff",
	"woff2",
	"xls",
	"xlsm",
	"xlsx",
	"xltm",
	"xltx",
	"xm",
	"xpi",
	"xz",
	"zip",
	"zst",
];

const binaryExtensionSet = new Set(binaryExtensions);
const textExtensionSet = new Set([
	"astro",
	"c",
	"cc",
	"cfg",
	"conf",
	"cpp",
	"cs",
	"css",
	"csv",
	"cxx",
	"dart",
	"env",
	"go",
	"graphql",
	"h",
	"hpp",
	"htm",
	"html",
	"ini",
	"java",
	"js",
	"json",
	"jsonl",
	"jsx",
	"kt",
	"kts",
	"less",
	"log",
	"lua",
	"md",
	"mjs",
	"ndjson",
	"php",
	"properties",
	"py",
	"rb",
	"rs",
	"sass",
	"scss",
	"sh",
	"sql",
	"svg",
	"swift",
	"toml",
	"ts",
	"tsx",
	"tsv",
	"txt",
	"vue",
	"xml",
	"yaml",
	"yml",
]);

const binaryMimePrefixes = ["audio/", "font/", "image/", "model/", "video/"];

const textMimeTypes = new Set([
	"application/javascript",
	"application/json",
	"application/ld+json",
	"application/manifest+json",
	"application/sql",
	"application/toml",
	"application/typescript",
	"application/x-httpd-php",
	"application/x-javascript",
	"application/x-php",
	"application/x-sh",
	"application/x-yaml",
	"application/xhtml+xml",
	"application/xml",
	"image/svg+xml",
]);

const binaryMimeTypes = new Set([
	"application/epub+zip",
	"application/gzip",
	"application/java-archive",
	"application/java-vm",
	"application/msword",
	"application/octet-stream",
	"application/ogg",
	"application/pdf",
	"application/vnd.android.package-archive",
	"application/vnd.apple.keynote",
	"application/vnd.apple.numbers",
	"application/vnd.apple.pages",
	"application/vnd.ms-cab-compressed",
	"application/vnd.ms-excel",
	"application/vnd.ms-fontobject",
	"application/vnd.ms-outlook",
	"application/vnd.ms-powerpoint",
	"application/vnd.ms-visio",
	"application/vnd.oasis.opendocument.graphics",
	"application/vnd.oasis.opendocument.presentation",
	"application/vnd.oasis.opendocument.spreadsheet",
	"application/vnd.oasis.opendocument.text",
	"application/vnd.openxmlformats-officedocument.presentationml.presentation",
	"application/vnd.openxmlformats-officedocument.presentationml.slideshow",
	"application/vnd.openxmlformats-officedocument.presentationml.template",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	"application/vnd.openxmlformats-officedocument.wordprocessingml.template",
	"application/wasm",
	"application/x-7z-compressed",
	"application/x-ace-compressed",
	"application/x-apple-diskimage",
	"application/x-arj",
	"application/x-asar",
	"application/x-bzip2",
	"application/x-cpio",
	"application/x-deb",
	"application/x-dosexec",
	"application/x-elf",
	"application/x-font-ttf",
	"application/x-font-woff",
	"application/x-indesign",
	"application/x-lz4",
	"application/x-mach-binary",
	"application/x-msdownload",
	"application/x-rar-compressed",
	"application/x-rpm",
	"application/x-shockwave-flash",
	"application/x-sqlite3",
	"application/x-tar",
	"application/x-xz",
	"application/zip",
	"application/zstd",
]);

/**
 * MIME types that only mean "unknown type". Storage providers (e.g. Termux's
 * DocumentsProvider) report these for any extension missing from Android's
 * MIME table, including plain-text formats such as `.jsonl`, so they must not
 * be treated as proof of binary content.
 */
const genericMimeTypes = new Set(["application/octet-stream"]);

export function isBinaryFile(file) {
	if (typeof file === "string") return isBinaryPath(file);
	if (!file) return false;

	if (isTextFile(file)) return false;
	const mime = file.mime || file.type;
	if (isBinaryMime(mime) && !genericMimeTypes.has(normalizeMime(mime))) {
		return true;
	}

	return isBinaryPath(file.url || file.path || file.name);
}

/**
 * Whether the file is known to be text from its MIME type or extension alone,
 * without looking at its content.
 * @param {string|{mime?: string, type?: string, url?: string, path?: string, name?: string}} file
 * @returns {boolean}
 */
export function isTextFile(file) {
	if (typeof file === "string") return isTextPath(file);
	if (!file) return false;
	return (
		isTextMime(file.mime || file.type) ||
		isTextPath(file.url || file.path || file.name)
	);
}

/**
 * Checks decoded text for control characters that do not appear in text
 * files. Mirrors `hasBinaryChars` in the native WorkspaceIndex so files whose
 * type is unknown are still skipped when their content is binary. ESC (27) is
 * allowed because logs commonly contain ANSI color sequences.
 * @param {string} text
 * @returns {boolean}
 */
export function hasBinaryContent(text) {
	if (typeof text !== "string") return false;
	const len = Math.min(text.length, 2048);
	for (let i = 0; i < len; i++) {
		const ch = text.charCodeAt(i);
		if (
			ch <= 8 ||
			ch === 11 ||
			(ch >= 14 && ch <= 31 && ch !== 27) ||
			ch === 127
		) {
			return true;
		}
	}
	return false;
}

export function isTextPath(file) {
	const path = String(file ?? "").split(/[?#]/)[0];
	const basename = path.split(/[\\/]/).pop()?.toLowerCase() || "";
	const lastDot = basename.lastIndexOf(".");
	if (lastDot === -1) return false;
	return textExtensionSet.has(basename.slice(lastDot + 1));
}

export function isBinaryPath(file) {
	const path = String(file ?? "").split(/[?#]/)[0];
	const basename = path.split(/[\\/]/).pop()?.toLowerCase() || "";

	const lastDot = basename.lastIndexOf(".");
	if (lastDot === -1) return false;

	const singleExtension = basename.slice(lastDot + 1);
	if (binaryExtensionSet.has(singleExtension)) return true;

	const previousDot = basename.lastIndexOf(".", lastDot - 1);
	if (previousDot === -1) return false;

	const compoundExtension = basename.slice(previousDot + 1);
	return binaryExtensionSet.has(compoundExtension);
}

export function isBinaryMime(mime) {
	const normalized = normalizeMime(mime);
	if (!normalized || isTextMime(normalized)) return false;
	if (binaryMimeTypes.has(normalized)) return true;

	return binaryMimePrefixes.some((prefix) => normalized.startsWith(prefix));
}

function isTextMime(mime) {
	const normalized = normalizeMime(mime);
	if (!normalized) return false;
	if (textMimeTypes.has(normalized)) return true;

	return normalized.startsWith("text/");
}

function normalizeMime(mime) {
	if (!mime || typeof mime !== "string") return "";
	return mime.split(";")[0].trim().toLowerCase();
}

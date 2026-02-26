import "core-js/stable";
import picomatch from "picomatch/posix";

const resolvers = {};

self.onmessage = (ev) => {
	const { action, data, error, id } = ev.data;
	switch (action) {
		case "search-files":
			processFiles(data, "search");
			break;

		case "replace-files":
			processFiles(data, "replace");
			break;

		case "get-file": {
			if (!resolvers[id]) return;
			const cb = resolvers[id];
			cb(data, error);
			delete resolvers[id];
			break;
		}

		default:
			return false;
	}
};

/**
 * Process files for search or replace operations.
 *
 * @param {object} data - The data containing files, search, replace, and options.
 * @param {'search' | 'replace'} [mode='search'] - The mode of operation (search or replace).
 */
function processFiles(data, mode = "search") {
	const process = mode === "search" ? searchInFile : replaceInFile;
	const { files, search, replace, options } = data;
	const { test: skip } = Skip(options);
	const total = files.length;
	let count = 0;

	files.forEach(processFile);

	/**
	 * Process a file for search or replace operation.
	 *
	 * @param {object} file - The file object to process.
	 * @param {string} file.url - The URL of the file.
	 */
	function processFile(file) {
		if (skip(file)) {
			done(++count / total, mode);
			return;
		}

		getFile(file.url, (res, err) => {
			if (err) {
				done(++count / total, mode);
				throw err;
			}

			process({ file, content: res, search, replace, options });
			done(++count / total, mode);
		});
	}
}

/**
 * Search for a string in the content of a file.
 * @param {object} arg - The content of the file to search.
 * @param {import('lib/fileList').Tree} arg.file - The file.
 * @param {string} arg.content - The file content.
 * @param {RegExp} arg.search - The string to search for.
 */
function searchInFile({ file, content, search }) {
	const matches = [];

	let text = `${file.name}`;
	let match;

	if (text.length > 30) {
		text = `...${text.slice(-30)}`;
	}

	while ((match = search.exec(content))) {
		const [word] = match;
		const start = match.index;
		const end = start + word.length;
		const position = {
			start: getLineColumn(content, start),
			end: getLineColumn(content, end),
		};
		const [line, renderText] = getSurrounding(content, word, start, end);
		text += `\n\t${line.trim()}`;
		matches.push({ match: word, position, renderText });
	}

	self.postMessage({
		action: "search-result",
		data: {
			file,
			matches,
			text,
		},
	});
}

/**
 * Replace a string in the content of a file.
 * @param {object} arg - The content of the file to search.
 * @param {import('lib/fileList').Tree} arg.file - The content of the file to search.
 * @param {string} content - The content of the file to search.
 * @param {RegExp} arg.search - The string to search for.
 * @param {string} arg.replace - The string to replace with.
 */
function replaceInFile({ file, content, search, replace }) {
	const text = content.replace(search, replace);

	self.postMessage({
		action: "replace-result",
		data: { file, text },
	});
}

/**
 * Gets surrounding text of a match.
 * @param {string} content
 * @param {string} word
 * @param {number} start
 * @param {number} end
 */
function getSurrounding(content, word, start, end) {
	const max = 50;
	const remaining = max - (end - start);
	let result = [];

	if (remaining <= 0) {
		word = word.slice(-max);
		result = [`...${word}`, word];
	} else {
		let left = Math.floor(remaining / 2);
		let right = left;

		let leftText = content.substring(start - left, start);
		let rightText = content.substring(end, end + right);

		result = [`${leftText}${word}${rightText}`, word];
	}

	return result.map((text) => text.replace(/[\r\n]+/g, " ⏎ "));
}

/**
 * Determines the line and column numbers for a given position in the file.
 *
 * @param {string} file - The file content as a string.
 * @param {number} position - The position in the file for which line and column
 * numbers are to be determined.
 *
 * @returns {Object} An object with 'line' and 'column' properties, representing
 * the line and column numbers respectively for the given position.
 *
 * @example
 *
 * const file = 'Hello, this is a test.\nAnother test is here.';
 * const position = 15;
 * const lineColumn = getLineColumn(file, position);
 *
 * // lineColumn: { line: 1, column: 16 }
 */
function getLineColumn(file, position) {
	const lines = file.substring(0, position).split("\n");
	const lineNumber = lines.length - 1;
	const columnNumber = lines[lineNumber].length;
	return { row: lineNumber, column: columnNumber };
}

/**
 * Retrieves the contents of a file from the main thread.
 * @param {string} url
 * @param {function} cb
 */
function getFile(url, cb) {
	const id = Number.parseInt(Date.now() + Math.random() * 1000000);
	resolvers[id] = cb;
	self.postMessage({
		action: "get-file",
		data: url,
		id,
	});
}

/**
 * Sends a message to the main thread to indicate that the worker is done searching
 * or replacing.
 * @param {boolean} ratio
 * @param {'search'|'replace'} mode
 */
function done(ratio, mode) {
	if (ratio === 1) {
		self.postMessage({
			action: "progress",
			data: 100,
		});
		self.postMessage({
			action: `done-${mode === "search" ? "searching" : "replacing"}`,
		});
	} else {
		self.postMessage({
			action: "progress",
			data: Math.floor(ratio * 100),
		});
	}
}

/**
 * Creates a skip function that filters files based on exclusion and inclusion patterns.
 *
 * @param {object} arg - The exclusion patterns separated by commas.
 * @param {string} arg.exclude - The exclusion patterns separated by commas.
 * @param {string} arg.include - The inclusion patterns separated by commas.
 */
function Skip({ exclude, include }) {
	// Default exclude patterns for binary/media/archives/fonts/etc.
	const defaultExcludes = [
		"**/*.png",
		"**/*.jpg",
		"**/*.jpeg",
		"**/*.gif",
		"**/*.bmp",
		"**/*.webp",
		"**/*.avif",
		"**/*.ico",
		"**/*.svgz",
		"**/*.mp3",
		"**/*.wav",
		"**/*.ogg",
		"**/*.flac",
		"**/*.m4a",
		"**/*.aac",
		"**/*.mp4",
		"**/*.mkv",
		"**/*.webm",
		"**/*.mov",
		"**/*.avi",
		"**/*.zip",
		"**/*.gz",
		"**/*.bz2",
		"**/*.xz",
		"**/*.7z",
		"**/*.rar",
		"**/*.tar",
		"**/*.exe",
		"**/*.dll",
		"**/*.so",
		"**/*.bin",
		"**/*.class",
		"**/*.ttf",
		"**/*.otf",
		"**/*.woff",
		"**/*.woff2",
		"**/*.pdf",
		"**/*.psd",
		"**/*.ai",
		"**/*.sketch",
	];
	const userExcludes = (exclude ? exclude.split(",") : [])
		.map((p) => p.trim())
		.filter(Boolean);
	const excludeFiles = [...defaultExcludes, ...userExcludes];
	const includeFiles = (include ? include.split(",") : ["**"]).map((p) =>
		p.trim(),
	);

	/**
	 * Tests whether a file should be skipped based on exclusion and inclusion patterns.
	 *
	 * @param {object} file - The file to be tested.
	 * @param {string} file.path - The relative URL of the file.
	 * @returns {boolean} - Returns true if the file should be skipped, false otherwise.
	 */
	function test(file) {
		if (!file.path) return false;
		const match = (pattern) =>
			picomatch.isMatch(file.path, pattern, { matchBase: true });
		return excludeFiles.some(match) || !includeFiles.some(match);
	}

	return {
		test,
	};
}

/**
 * @typedef {Object} Match
 * @property {string} line - The line of the file where the match was found.
 * @property {string} text - Match result converted to a string.
 * @property {Object} position - An object representing the start and end positions of the match.
 * @property {Object} position.start - An object with properties line and column representing the start position.
 * @property {number} position.start.line - The line number of the start position.
 * @property {number} position.start.column - The column number of the start position.
 * @property {Object} position.end - An object with properties line and column representing the end position.
 * @property {number} position.end.line - The line number of the end position.
 * @property {number} position.end.column - The column number of the end position.
 */

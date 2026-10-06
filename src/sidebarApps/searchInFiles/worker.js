import "core-js/stable";
import picomatch from "picomatch/posix";
import { isBinaryFile } from "utils/binaryExtensions";

const resolvers = {};
let requestId = 0;
const MAX_CONCURRENT_FILE_READS = 2;
const RESULT_BATCH_SIZE = 200;

self.onmessage = (ev) => {
	const { action, data, error, id } = ev.data;
	switch (action) {
		case "search-files":
			processFiles(data, "search");
			break;

		case "replace-files":
			processFiles(data, "replace");
			break;

		case "result-ack":
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
	let cursor = 0;
	let active = 0;
	let pumpScheduled = false;

	if (!total) {
		done(1, mode);
		return;
	}

	pump();

	/**
	 * Starts more file reads without flooding the main thread.
	 */
	function pump() {
		pumpScheduled = false;
		while (active < MAX_CONCURRENT_FILE_READS && cursor < total) {
			const file = files[cursor++];
			active += 1;
			processFile(file);
		}
	}

	function schedulePump() {
		if (pumpScheduled) return;
		pumpScheduled = true;
		Promise.resolve().then(pump);
	}

	function finishOne() {
		active -= 1;
		done(++count / total, mode);
		schedulePump();
	}

	/**
	 * Process a file for search or replace operation.
	 * @param {object} file
	 */
	function processFile(file) {
		if (skip(file)) {
			finishOne();
			return;
		}

		getFile(file.url, async (res, err) => {
			if (err) {
				finishOne();
				return;
			}

			self.postMessage({ action: "processing" });
			await process({
				file,
				content: res,
				search,
				replace,
				options,
			});
			self.postMessage({ action: "processed" });
			finishOne();
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
async function searchInFile({ file, content, search }) {
	let matches = [];
	search = new RegExp(search.source, search.flags);
	async function flush() {
		if (!matches.length) return;
		const batch = matches;
		matches = [];
		await new Promise((resolve) => {
			const id = ++requestId;
			resolvers[id] = resolve;
			self.postMessage({
				action: "search-result",
				id,
				data: { file, matches: batch },
			});
		});
		self.postMessage({ action: "processing" });
	}
	let cursor = 0;
	let row = 0;
	let column = 0;
	function positionAt(offset) {
		while (cursor < offset) {
			if (content[cursor++] === "\n") {
				row++;
				column = 0;
			} else column++;
		}
		return { row, column };
	}
	search.lastIndex = 0;
	let match;
	while ((match = search.exec(content))) {
		const word = match[0];
		const start = match.index;
		const end = start + word.length;
		const position = { start: positionAt(start), end: positionAt(end) };
		const [line, renderText] = getSurrounding(content, word, start, end);
		matches.push({ match: word.slice(0, 160), position, renderText, line });
		if (matches.length >= RESULT_BATCH_SIZE) await flush();
		if (!search.global && !search.sticky) break;
		if (!word.length) {
			// AdvanceStringIndex: don't restart inside a Unicode surrogate pair.
			search.lastIndex =
				end + (search.unicode && content.codePointAt(end) > 0xffff ? 2 : 1);
		}
	}
	await flush();
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
	const max = 160;
	const remaining = Math.max(0, max - (end - start));
	let left = start;
	const leftLimit = Math.max(0, start - Math.floor(remaining / 2));
	while (left > leftLimit && !/[\r\n]/.test(content[left - 1])) left--;
	let right = Math.min(end, start + max);
	const rightLimit = Math.min(content.length, start + max - (start - left));
	while (right < rightLimit && !/[\r\n]/.test(content[right])) right++;
	let line = content.slice(left, right).trim();
	if (left > 0 && !/[\r\n]/.test(content[left - 1])) line = `...${line}`;
	if (right < content.length && !/[\r\n]/.test(content[right])) line += "...";
	return [line, word.slice(0, max)].map((text) =>
		text.replace(/[\r\n]+/g, " ⏎ "),
	);
}

/**
 * Retrieves the contents of a file from the main thread.
 * @param {string} url
 * @param {function} cb
 */
function getFile(url, cb) {
	const id = ++requestId;
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
	const userExcludes = (exclude ? exclude.split(",") : [])
		.map((p) => p.trim())
		.filter(Boolean);
	const excludeFiles = userExcludes;
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
		if (isBinaryFile(file)) return true;
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

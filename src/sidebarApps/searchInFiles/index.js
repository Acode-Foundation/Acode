import "./styles.scss";
import fsOperation from "fileSystem";
import { EditorView } from "@codemirror/view";
import autosize from "autosize";
import Checkbox from "components/checkbox";
import Sidebar, { preventSlide } from "components/sidebar";
import escapeStringRegexp from "escape-string-regexp";
import Reactive from "html-tag-js/reactive";
import Ref from "html-tag-js/ref";
import files, { Tree, whenReady as waitForFileList } from "lib/fileList";
import openFile from "lib/openFile";
import settings from "lib/settings";
import helpers from "utils/helpers";
import { createSearchResultView } from "./cmResultView";

// Local highlight sources
const words = [];
const fileNames = [];
const MAX_HL_WORDS = 400; // cap to avoid massive regex in result view

const workers = [];
const results = [];
const filesSearched = [];
const filesReplaced = [];

const $container = Ref();
const $regExp = Ref();
const $search = Ref();
const $replace = Ref();
const $exclude = Ref();
const $include = Ref();
const $wholeWord = Ref();
const $caseSensitive = Ref();
const $useIndex = Ref();
const $btnReplaceAll = Ref();
const $resultOverview = Ref();
const $error = Reactive();
const $progress = Reactive();
const $indexStatus = Reactive("");

const FILE_LIST_WAIT_TIMEOUT = 250;
const SEARCH_WORKER_COUNT = 1;

const resultOverview = {
	filesCount: 0,
	matchesCount: 0,
	reset() {
		this.filesCount = 0;
		this.matchesCount = 0;
		$resultOverview.innerHTML = searchResultText(0, 0);
		$resultOverview.classList.remove("error");
	},
};

const CASE_SENSITIVE = "search-in-files-case-sensitive";
const WHOLE_WORD = "search-in-files-whole-word";
const REG_EXP = "search-in-files-reg-exp";
const EXCLUDE = "search-in-files-exclude";
const INCLUDE = "search-in-files-include";
const USE_INDEX = "search-in-files-use-native-index";

const store = {
	get caseSensitive() {
		return localStorage.getItem(CASE_SENSITIVE) === "true";
	},
	set caseSensitive(value) {
		localStorage.setItem(CASE_SENSITIVE, value);
	},
	get wholeWord() {
		return localStorage.getItem(WHOLE_WORD) === "true";
	},
	set wholeWord(value) {
		return localStorage.setItem(WHOLE_WORD, value);
	},
	get regExp() {
		return localStorage.getItem(REG_EXP) === "true";
	},
	set regExp(value) {
		return localStorage.setItem(REG_EXP, value);
	},
	get exclude() {
		return localStorage.getItem(EXCLUDE);
	},
	set exclude(value) {
		return localStorage.setItem(EXCLUDE, value);
	},
	get include() {
		return localStorage.getItem(INCLUDE);
	},
	set include(value) {
		return localStorage.setItem(INCLUDE, value);
	},
	get useIndex() {
		return localStorage.getItem(USE_INDEX) === "true";
	},
	set useIndex(value) {
		localStorage.setItem(USE_INDEX, value);
	},
};

const debounceSearch = helpers.debounce(searchAll, 500);

let showReplace = false;
let showExtras = !!(store.exclude || store.include);
let useIncludeAndExclude = showExtras;
const $headerEl = Ref();
let searchResult = null; // CM6 wrapper from createSearchResultView
let currentSearchRegex = null;
let resultScrollTop = 0;
let resultScrollLeft = 0;
let resultScrollRestoreFrame = 0;
let replacing = false;
let newFiles = 0;
let searching = false;
let searchVersion = 0;
let pendingResultText = "";
let pendingResultFlush = 0;
let nativeSearchId = null;
let activeSearchTasks = 0;
let activeReplaceTasks = 0;

addEventListener($regExp, "change", onInput);
addEventListener($wholeWord, "change", onInput);
addEventListener($caseSensitive, "change", onInput);
addEventListener($useIndex, "change", onInput);
addEventListener($search, "input", onInput);
addEventListener($include, "input", onInput);
addEventListener($exclude, "input", onInput);
addEventListener($btnReplaceAll, "click", replaceAll);

files.on("push-file", () => {
	if (!searching) return;
	$error.value = strings["missed files"].replace("{count}", ++newFiles);
});

$container.onref = ($el) => {
	searchResult = createSearchResultView($el, {
		onLineClick: onCursorChange,
		getWords: () => words,
		getFileNames: () => fileNames,
		getRegex: () => currentSearchRegex,
	});
	searchResult.view.scrollDOM?.addEventListener(
		"scroll",
		rememberResultScroll,
		{
			passive: true,
		},
	);
	restoreResultScroll();
	$container.style.lineHeight = "1.5";
};

preventSlide((target) => {
	return $container.el?.contains(target);
});

Sidebar.on("show", restoreResultScroll);

function toggleReplace() {
	showReplace = !showReplace;
	$headerEl.el.classList.toggle("show-replace", showReplace);
	const $btn = $headerEl.el.querySelector(".actions button:first-child");
	if ($btn) $btn.classList.toggle("active", showReplace);
}

function toggleExtras() {
	showExtras = !showExtras;
	$headerEl.el.classList.toggle("show-extras", showExtras);
	const $btn = $headerEl.el.querySelector(".actions button:last-child");
	if ($btn) $btn.classList.toggle("active", showExtras);
	useIncludeAndExclude = showExtras;
	if ($exclude.el?.value || $include.el?.value) {
		onInput();
	}
}

export default [
	"search",
	"searchInFiles",
	strings["search in files"],
	(/**@type {HTMLElement} */ el) => {
		el.classList.add("search-in-files");

		el.content = (
			<>
				<div
					ref={$headerEl}
					className={`header${showReplace ? " show-replace" : ""}${showExtras ? " show-extras" : ""}`}
				>
					<div className="title-container">
						<span className="title-text">{strings["search in files"]}</span>
						<div className="actions">
							<button
								type="button"
								className={`icon-button${showReplace ? " active" : ""}`}
								onclick={toggleReplace}
								title={strings["replace"]}
							>
								<span className="icon replace_all" />
							</button>
							<button
								type="button"
								className={`icon-button${showExtras ? " active" : ""}`}
								onclick={toggleExtras}
								title={`${strings["exclude files"]} / ${strings["include files"]}`}
							>
								<span className="icon tune" />
							</button>
						</div>
					</div>

					<div className="options">
						<Checkbox
							checked={store.caseSensitive}
							size="10px"
							text="aA"
							ref={$caseSensitive}
						/>
						<Checkbox
							checked={store.wholeWord}
							size="10px"
							text="a-z"
							ref={$wholeWord}
						/>
						<Checkbox
							checked={store.regExp}
							size="10px"
							text=".*"
							ref={$regExp}
						/>
						<Checkbox
							checked={store.useIndex}
							size="10px"
							text="IDX"
							ref={$useIndex}
						/>
					</div>

					<div className="search-row">
						<Textarea
							ref={$search}
							type="search"
							name="search"
							placeholder={strings["search"]}
						/>
					</div>

					<div className="replace-row">
						<Textarea
							ref={$replace}
							type="search"
							name="replace"
							placeholder={strings["replace"]}
						/>
						<button
							ref={$btnReplaceAll}
							className="icon replace_all"
							title={strings["replace"]}
						></button>
					</div>

					<div className="extras-row">
						<input
							value={store.exclude}
							ref={$exclude}
							type="search"
							name="exclude"
							placeholder={strings["exclude files"]}
						/>
						<input
							value={store.include}
							ref={$include}
							type="search"
							name="include"
							placeholder={strings["include files"]}
						/>
					</div>
				</div>
				<div className="search-result-header">
					<span ref={$resultOverview} innerHTML={searchResultText(0, 0)}></span>{" "}
					({$progress}%)
				</div>
				<div className="index-status">{$indexStatus}</div>
				<div className="error">{$error}</div>
				<div
					ref={$container}
					className="search-in-file-editor editor-container"
				></div>
			</>
		);
	},
	false, // show as first item
	() => {},
];

/**
 * Worker message handler
 * @param {Event} e
 */
async function onWorkerMessage(e) {
	const { action, error, data, id } = e.data;
	const version = e.target.searchVersion;
	if (version !== searchVersion) return;
	if (error) {
		window.log("error", error);
		console.error(error);
		return;
	}

	switch (action) {
		case "get-file": {
			let readError;

			let content = "";
			try {
				content = await readSearchFileContent(data);
			} catch (er) {
				readError = er;
			}

			e.target.postMessage({
				id,
				action: "get-file",
				data: content,
				error: readError,
			});
			break;
		}

		case "search-result": {
			appendSearchResult(data);
			break;
		}

		case "replace-result": {
			const { file, text } = data;
			filesReplaced.push(file);
			openFile(file.url, {
				render: filesSearched.length === filesReplaced.length,
				text,
			});
			break;
		}

		case "done-replacing": {
			e.target.doneReplacing = true;

			terminateWorker(false);
			await finishReplaceTask(version);
			break;
		}

		case "done-searching": {
			e.target.doneSearching = true;

			if (workers.find((worker) => worker.started && !worker.doneSearching)) {
				break;
			}

			terminateWorker(false);
			await finishSearchTask(version);
			break;
		}

		case "progress": {
			e.target.progress = data;
			const startedWorkers = workers.filter((worker) => worker.started);
			const progress = Math.round(
				startedWorkers.reduce((acc, { progress = 0 }) => acc + progress, 0) /
					startedWorkers.length,
			);
			$progress.value = progress;
			break;
		}

		default:
			break;
	}
}

function appendSearchResult(data) {
	const { file, matches, limited } = data;

	if (!matches.length) return;
	if (filesSearched.find((item) => item.url === file.url)) return;

	filesSearched.push(Tree.fromJSON(file));
	if (filesSearched.length === 1) {
		searchResult.setValue("");
	}
	resultOverview.filesCount += 1;
	resultOverview.matchesCount += matches.length;
	$resultOverview.innerHTML = searchResultText(
		resultOverview.filesCount,
		resultOverview.matchesCount,
	);

	const index = filesSearched.length - 1;
	const displayRows = groupMatchesForDisplay(matches);
	results.push({
		file: index,
		match: null,
		position: null,
	});

	fileNames.push({ name: file.name, path: file.path, count: matches.length });
	for (const result of matches) {
		result.file = index;
		if (words.length < MAX_HL_WORDS) {
			const token = escapeStringRegexp(result.renderText);
			if (!words.includes(token)) words.push(token);
		}
	}
	for (const { result } of displayRows) {
		results.push(result);
	}
	if (limited) {
		results.push({
			file: index,
			match: null,
			position: null,
			notice: true,
		});
	}

	const text = formatSearchResultText(file, displayRows, limited);
	if (fileNames.length > 1) {
		appendSearchResultText(`\n${text}`);
	} else {
		appendSearchResultText(text);
	}
}

function groupMatchesForDisplay(matches) {
	const rows = [];
	const seen = new Set();
	for (const result of matches) {
		const row = result.position?.start?.row ?? -1;
		const preview = String(
			result.line || result.text || result.renderText || result.match || "",
		).trim();
		const key = `${row}\n${preview}`;
		if (seen.has(key)) continue;
		seen.add(key);
		rows.push({ result, preview });
	}
	return rows;
}

function formatSearchResultText(file, displayRows, limited) {
	const lines = [file.name];
	for (const { result, preview } of displayRows) {
		const row = result.position?.start?.row;
		const lineNumber = Number.isInteger(row) ? `${row + 1}: ` : "";
		lines.push(`\t${lineNumber}${preview}`);
	}
	if (limited) {
		lines.push("\t... result limit reached for this file");
	}
	return lines.join("\n");
}

async function finishSearchTask(version = searchVersion) {
	if (version !== searchVersion) return;
	activeSearchTasks = Math.max(0, activeSearchTasks - 1);
	if (activeSearchTasks > 0) return;

	const showAd = results.length > 100;
	if (showAd) {
		await helpers.showInterstitialIfReady();
		if (version !== searchVersion) return;
	}

	if (!results.length) {
		searchResult.setGhostText(strings["no result"], { row: 0, column: 0 });
	}

	searching = false;
	nativeSearchId = null;
	$indexStatus.value = "";
}

async function finishReplaceTask(version = searchVersion) {
	if (version !== searchVersion) return;
	activeReplaceTasks = Math.max(0, activeReplaceTasks - 1);
	if (activeReplaceTasks > 0) return;
	await helpers.showInterstitialIfReady();
	if (version !== searchVersion) return;
	replacing = false;
	nativeSearchId = null;
	$indexStatus.value = "";
}

/**
 * On input event handler
 * @param {InputEvent} e
 */

function onInput(e) {
	if (!searchResult || replacing) return;

	const { target } = e || {};

	if (target === $caseSensitive.el) {
		store.caseSensitive = $caseSensitive.el.checked;
	}

	if (target === $wholeWord.el) {
		store.wholeWord = $wholeWord.el.checked;
	}

	if (target === $regExp.el) {
		store.regExp = $regExp.el.checked;
	}

	if (target === $useIndex.el) {
		store.useIndex = $useIndex.el.checked;
	}

	if (target === $exclude.el) {
		store.exclude = $exclude.el.value;
	}

	if (target === $include.el) {
		store.include = $include.el.value;
	}

	terminateWorker();
	cancelNativeSearch();
	$indexStatus.value = "";
	searchVersion += 1;
	searching = false;
	activeSearchTasks = 0;
	activeReplaceTasks = 0;
	newFiles = 0;
	$error.value = "";
	results.length = 0;
	words.length = 0;
	fileNames.length = 0;
	currentSearchRegex = null;
	$progress.value = 0;
	filesSearched.length = 0;
	resultOverview.reset();
	resetResultScroll();
	clearPendingResultText();
	searchResult.setValue("");
	searchResult.setGhostText(strings["searching..."], { row: 0, column: 0 });
	removeEvents();
	debounceSearch();
}

async function searchAll() {
	const search = $search.value;
	if (!search) {
		searchResult.removeGhostText();
		return;
	}

	const options = getOptions();
	const regex = toRegex(search, options);
	if (!regex) {
		searchResult.removeGhostText();
		return;
	}

	addEvents();

	const version = searchVersion;
	await waitForFileListIfReady();
	if (version !== searchVersion) return;

	const allFiles = files().filter((file) => !helpers.isBinary(file));
	const forceUrls = new Set();
	editorManager.files.forEach((file) => {
		if (!file.uri || helpers.isBinary(file.uri)) return;
		forceUrls.add(file.uri);
		const exists = allFiles.find((f) => f.url === file.uri);
		if (exists) return;

		allFiles.push(new Tree(file.name, file.uri, false));
	});

	const filesToSearch = allFiles;

	if (!filesToSearch.length) {
		searchResult.setGhostText(strings["no result"], { row: 0, column: 0 });
		$progress.value = 100;
		return;
	}

	searching = true;
	words.length = 0;
	fileNames.length = 0;
	currentSearchRegex = regex;
	searchResult.setGhostText(strings["searching..."], { row: 0, column: 0 });
	const nativeFiles = filesToSearch.filter((file) =>
		supportsNativeSearch(file.url),
	);
	const workerFiles = filesToSearch.filter(
		(file) => !supportsNativeSearch(file.url),
	);
	activeSearchTasks = 0;
	if (nativeFiles.length) {
		activeSearchTasks += 1;
		sendNativeSearch("search", nativeFiles, search, options);
	}
	if (workerFiles.length) {
		activeSearchTasks += 1;
		sendMessage("search-files", workerFiles, regex, options);
	}
}

async function readSearchFileContent(uri) {
	if (helpers.isBinary(uri)) return "";

	const editorFile = editorManager.getFile(uri, "uri");
	if (editorFile?.session?.doc) {
		try {
			return editorFile.session.doc.toString() || "";
		} catch (_) {
			return "";
		}
	}

	return fsOperation(uri).readFile(settings.value.defaultFileEncoding);
}

function supportsNativeSearch(url = "") {
	return (
		typeof sdcard !== "undefined" &&
		typeof sdcard.workspaceSearch === "function" &&
		(/^file:/.test(url) || /^content:/.test(url))
	);
}

function cancelNativeSearch() {
	if (!nativeSearchId || typeof sdcard === "undefined") return;
	try {
		sdcard.workspaceCancel(nativeSearchId);
	} catch (_) {
		// ignore cancellation failures
	}
	nativeSearchId = null;
}

function sendNativeSearch(mode, searchFiles, search, options, replace) {
	const id = `search-${Date.now()}-${Math.random().toString(36).slice(2)}`;
	const version = searchVersion;
	nativeSearchId = id;
	sdcard.workspaceSearch(
		{
			id,
			mode,
			files: searchFiles.map((file) => file.toJSON()),
			search,
			replace,
			options,
			overlays: getOpenFileOverlays(searchFiles),
			defaultEncoding: settings.value.defaultFileEncoding,
			useIndex: store.useIndex,
		},
		async (event) => {
			if (
				!event ||
				event.id !== id ||
				version !== searchVersion ||
				nativeSearchId !== id
			)
				return;
			switch (event.type || event.action) {
				case "status":
					$indexStatus.value = event.message || "";
					break;
				case "progress":
					$progress.value = event.data || 0;
					break;
				case "search-result":
					appendSearchResult(event.data);
					break;
				case "replace-result":
					filesReplaced.push(event.file);
					openFile(event.file.url, {
						render: filesSearched.length === filesReplaced.length,
						text: event.text,
					});
					break;
				case "done-searching":
					nativeSearchId = null;
					await finishSearchTask(version);
					break;
				case "done-replacing":
					nativeSearchId = null;
					await finishReplaceTask(version);
					break;
				case "error":
					console.error(event.error);
					$error.value = event.error || "Native search failed";
					nativeSearchId = null;
					await (mode === "replace"
						? finishReplaceTask(version)
						: finishSearchTask(version));
					break;
			}
		},
		async (error) => {
			if (version !== searchVersion || nativeSearchId !== id) return;
			console.error(error);
			$error.value = error?.message || String(error);
			nativeSearchId = null;
			await (mode === "replace"
				? finishReplaceTask(version)
				: finishSearchTask(version));
		},
	);
}

function getOpenFileOverlays(searchFiles) {
	const supportedUrls = new Set(searchFiles.map(({ url }) => url));
	const overlays = {};
	editorManager.files.forEach((file) => {
		if (!file.uri || !supportedUrls.has(file.uri)) return;
		if (!file.session?.doc) return;
		try {
			overlays[file.uri] = file.session.doc.toString() || "";
		} catch (_) {
			// ignore invalid editor docs
		}
	});
	return overlays;
}

async function waitForFileListIfReady() {
	const result = await withTimeout(waitForFileList(), FILE_LIST_WAIT_TIMEOUT);
	if (result === TIMEOUT) {
		$indexStatus.value = "Scanning project files...";
	}
}

function markIndexDirty(urls) {
	if (
		typeof sdcard !== "undefined" &&
		typeof sdcard.workspaceMarkDirty === "function"
	) {
		try {
			sdcard.workspaceMarkDirty(urls);
		} catch (_) {
			// ignore native dirty-mark failures
		}
	}
}

function appendSearchResultText(text) {
	pendingResultText += text;
	if (pendingResultFlush) return;

	const schedule =
		window.requestAnimationFrame || ((callback) => setTimeout(callback, 16));
	pendingResultFlush = schedule(() => {
		searchResult.insert(pendingResultText);
		pendingResultText = "";
		pendingResultFlush = 0;
	});
}

function clearPendingResultText() {
	if (!pendingResultFlush) return;

	const cancel = window.cancelAnimationFrame || clearTimeout;
	cancel(pendingResultFlush);
	pendingResultText = "";
	pendingResultFlush = 0;
}

const TIMEOUT = Symbol("timeout");

function withTimeout(promise, ms) {
	return Promise.race([
		promise,
		new Promise((resolve) => setTimeout(() => resolve(TIMEOUT), ms)),
	]);
}

/**
 * Replaces all occurrences of the search query with the replacement text in the files.
 * Sends a message to the worker threads to perform the replacement.
 */
async function replaceAll() {
	terminateWorker();
	filesReplaced.length = 0;

	const search = $search.value;
	const replace = $replace.value;
	const options = getOptions();
	if (!search || !replace) return;
	const regex = toRegex(search, options);
	if (!regex) return;

	replacing = true;
	activeReplaceTasks = 0;
	const nativeFiles = filesSearched.filter((file) =>
		supportsNativeSearch(file.url),
	);
	const workerFiles = filesSearched.filter(
		(file) => !supportsNativeSearch(file.url),
	);
	if (nativeFiles.length) {
		activeReplaceTasks += 1;
		sendNativeSearch("replace", nativeFiles, search, options, replace);
	}
	if (workerFiles.length) {
		activeReplaceTasks += 1;
		sendMessage("replace-files", workerFiles, regex, options, replace);
	}
	if (!activeReplaceTasks) replacing = false;
}

/**
 * Sends a message to the worker threads to perform a specific action on a subset of files.
 *
 * @param {string} action - The action to be performed by the worker threads.
 * @param {Array<Tree>} files - The files to be processed.
 * @param {string} search - The search query.
 * @param {object} options - The search options.
 * @param {string} replace - The replacement text (if applicable).
 */
function sendMessage(action, files, search, options, replace) {
	const len = workers.length;
	const limit = Math.ceil(files.length / len);
	for (let i = 0; i < len; i++) {
		const worker = workers[i];
		const offset = i * limit;
		const filesForThisWorker = files
			.slice(offset, offset + limit)
			.map((file) => file.toJSON());
		if (!filesForThisWorker.length) break;
		worker.started = true;
		worker.searchVersion = searchVersion;
		worker.postMessage({
			action: action,
			data: {
				files: filesForThisWorker,
				search,
				replace,
				options,
			},
		});
	}
}

/**
 * Worker error handler
 * @param {Error} e
 */
function onErrorMessage(e) {
	console.error(e);
}

/**
 * Terminates the existing Web Workers, if any, and then initializes new ones.
 * Also sets the onmessage and onerror handlers for these workers.
 * @param {boolean} [initializeNewWorkers=true] - Whether to initialize new workers after terminating the existing ones.
 */
function terminateWorker(initializeNewWorkers = true) {
	workers.forEach((worker) => worker.terminate());
	workers.length = 0;

	if (!initializeNewWorkers) return;

	const len = SEARCH_WORKER_COUNT;

	for (let i = 0; i < len; i++) {
		const worker = getWorker();
		worker.onmessage = onWorkerMessage;
		worker.onerror = onErrorMessage;
		workers.push(worker);
	}
}

/**
 * Creates and returns a new Web Worker that executes the code in 'searchInFilesWorker.build.js'.
 *
 * @returns {Worker} A new Worker object that runs the code in 'searchInFilesWorker.build.js'.
 */
function getWorker() {
	return new Worker("build/searchInFilesWorker.js");
}

/**
 * @typedef {object} Options
 * @property {boolean} caseSensitive
 * @property {boolean} wholeWord
 * @property {boolean} regExp
 * @property {string} exclude
 * @property {string} include
 */

/**
 * Retrieves the search options currently set in the user interface. This includes
 * search parameters such as 'case sensitive', 'whole word', 'regular expressions',
 * 'exclude' and 'include' depending on whether they are checked or filled in the UI.
 *
 * Note that the 'exclude' and 'include' options are only retrieved when
 * the corresponding UI section is expanded (i.e., `useIncludeAndExclude` is true).
 *
 * @returns {Options}
 */
function getOptions() {
	const exclude = useIncludeAndExclude ? $exclude.el.value.trim() : "";
	const include = useIncludeAndExclude ? $include.el.value.trim() : "";
	const caseSensitive = $caseSensitive.el.checked;
	const wholeWord = $wholeWord.el.checked;
	const regExp = $regExp.el.checked;

	return {
		caseSensitive,
		wholeWord,
		regExp,
		exclude,
		include,
	};
}

/**
 * Binds an event listener to the 'onref' method of the specified element reference.
 *
 * @param {Ref} $ref - The element reference containing the 'onref' method.
 * @param {string} type - The event type to listen for (e.g., 'input', 'change').
 * @param {Function} handler - The event handler function to be executed when the event occurs.
 * @returns {void}
 *
 * @example
 * // Add an input event listener to $search element reference
 * addEventListener($search, 'input', debounceInput);
 */
function addEventListener($ref, type, handler) {
	$ref.onref = ($el) => {
		$el.addEventListener(type, handler);
	};
}

/**
 * Generates a search result text based on the number of files and matches.
 *
 * @param {number} files - The number of files searched.
 * @param {number} matches - The number of matches found.
 * @returns {string} - The search result text.
 */
function searchResultText(files, matches) {
	return strings["search result"]
		.replace("{files}", `<strong>${files}</strong>`)
		.replace("{matches}", `<strong>${matches}</strong>`);
}

/**
 * A function component that returns a div element with the "details" attribute.
 *
 * @param {Object} props - The properties object for the component.
 * @param {Function} props.onexpand - Callback function to be executed when the div expands.
 * @param {Array} children - An array of child elements to be inserted into the div.
 *
 * @returns {HTMLDivElement} A div element with the "details" attribute, and any child elements.
 */

/**
 * Create a textarea element with autosize
 * @param {object} param0
 * @param {string} param0.name
 * @param {string} param0.placeholder
 * @param {Ref} param0.ref
 * @returns {HTMLTextAreaElement}
 */
function Textarea({ name, placeholder, ref }) {
	return autosize(
		<textarea ref={ref} name={name} placeholder={placeholder}></textarea>,
	);
}

/**
 * Converts a search string and options into a regular expression.
 *
 * @param {string} search - The search string.
 * @param {object} options - The search options.
 * @param {boolean} [options.caseSensitive=false] - Whether the search is case-sensitive.
 * @param {boolean} [options.wholeWord=false] - Whether to match whole words only.
 * @param {boolean} [options.regExp=false] - Whether the search string is a regular expression.
 * @returns {RegExp} - The regular expression created from the search string and options.
 */
function toRegex(search, options) {
	const { caseSensitive = false, wholeWord = false, regExp = false } = options;

	let flags = caseSensitive ? "gm" : "gim";
	let regexString = regExp ? search : escapeStringRegexp(search);

	if (wholeWord) {
		const wordBoundary = "\\b";
		regexString = `${wordBoundary}${regexString}${wordBoundary}`;
	}

	try {
		return new RegExp(regexString, flags);
	} catch (error) {
		const [, message] = error.message.split(/:(.*)/);
		$resultOverview.classList.add("error");
		$resultOverview.textContent = strings["invalid regex"].replace(
			"{message}",
			message || error.message,
		);
		return null;
	}
}

/**
 * On cursor change event handler
 */
async function onCursorChange(line) {
	const result = results[line];
	if (!result) return;
	const { file, position } = result;
	if (!position) {
		// header line clicked; CM view folding not implemented yet
		return;
	}

	rememberResultScroll();
	Sidebar.hide();
	const { url } = filesSearched[file];
	await openFile(url, { render: true });
	const { editor } = editorManager;
	try {
		// Compute offsets from row/column (rows from worker are 0-based)
		const doc = editor.state.doc;
		const startLine = doc.line(position.start.row + 1);
		const endLine = doc.line(position.end.row + 1);
		const from = Math.min(startLine.from + position.start.column, startLine.to);
		const to = Math.min(endLine.from + position.end.column, endLine.to);
		editor.dispatch({
			selection: { anchor: from, head: to },
			effects: EditorView.scrollIntoView(from, { y: "center" }),
		});
	} catch (error) {
		console.warn(`Failed to focus search result at line ${line}.`, error);
	}
}

/**
 * When a file is added or removed from the file list
 * @param {import('lib/fileList').Tree} tree
 */
function onFileUpdate(tree) {
	if (!tree || tree?.children) return;
	markIndexDirty([tree.url]);
	onInput();
}

function onEditorFileUpdate(file) {
	const uri = file?.uri;
	if (uri) markIndexDirty([uri]);
	onInput();
}

function rememberResultScroll() {
	const position = searchResult?.getScrollPosition?.();
	if (!position) return;
	resultScrollTop = position.top;
	resultScrollLeft = position.left;
}

function restoreResultScroll() {
	cancelAnimationFrame(resultScrollRestoreFrame);
	resultScrollRestoreFrame = requestAnimationFrame(() => {
		resultScrollRestoreFrame = 0;
		searchResult?.setScrollPosition?.({
			top: resultScrollTop,
			left: resultScrollLeft,
		});
	});
}

function resetResultScroll() {
	resultScrollTop = 0;
	resultScrollLeft = 0;
	cancelAnimationFrame(resultScrollRestoreFrame);
	resultScrollRestoreFrame = 0;
}

/**
 * Add event listeners to file changes
 */
function addEvents() {
	files.on("add-file", onFileUpdate);
	files.on("remove-file", onFileUpdate);
	files.on("add-folder", onInput);
	files.on("remove-folder", onInput);
	files.on("refresh", onInput);
	editorManager.on("rename-file", onEditorFileUpdate);
	editorManager.on("file-content-changed", onEditorFileUpdate);
}

/**
 * Remove event listeners to file changes
 */
function removeEvents() {
	files.off("add-file", onFileUpdate);
	files.off("remove-file", onFileUpdate);
	files.off("add-folder", onInput);
	files.off("remove-folder", onInput);
	files.off("refresh", onInput);
	editorManager.off("rename-file", onEditorFileUpdate);
	editorManager.off("file-content-changed", onEditorFileUpdate);
}

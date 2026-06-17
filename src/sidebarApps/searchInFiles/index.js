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
import { createSearchIndex } from "./searchIndex";

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
const $btnReplaceAll = Ref();
const $resultOverview = Ref();
const $error = Reactive();
const $progress = Reactive();
const $indexStatus = Reactive("");

const FILE_LIST_WAIT_TIMEOUT = 250;
const INDEX_QUERY_TIMEOUT = 120;
const INDEX_SYNC_DELAY = 700;
const IDLE_INDEX_RETRY_DELAY = 10000;
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
};

const debounceSearch = helpers.debounce(searchAll, 500);

let showReplace = false;
let showExtras = !!(store.exclude || store.include);
let useIncludeAndExclude = showExtras;
const $headerEl = Ref();
let searchResult = null; // CM6 wrapper from createSearchResultView
let currentSearchRegex = null;
let replacing = false;
let newFiles = 0;
let searching = false;
let searchVersion = 0;
let lastIndexSyncKey = "";
let pendingIndexFiles = null;
let indexSyncTimer = null;
let pendingResultText = "";
let pendingResultFlush = 0;

const searchIndex = createSearchIndex({
	readFile: readSearchFileContent,
	onStatus: updateIndexStatus,
});

addEventListener($regExp, "change", onInput);
addEventListener($wholeWord, "change", onInput);
addEventListener($caseSensitive, "change", onInput);
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
	$container.style.lineHeight = "1.5";
};

preventSlide((target) => {
	return $container.el?.contains(target);
});

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
		scheduleAutomaticIndex();
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
			const { file, matches, text } = data;

			if (!matches.length) return;
			if (filesSearched.includes(file)) return;

			filesSearched.push(Tree.fromJSON(file));
			// Clear any ghost text on first result
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
			results.push({
				file: index,
				match: null,
				position: null,
			});

			fileNames.push({ name: file.name, path: file.path });
			for (const result of matches) {
				result.file = index;
				results.push(result);
				if (words.length < MAX_HL_WORDS) {
					const token = escapeStringRegexp(result.renderText);
					if (!words.includes(token)) words.push(token);
				}
			}

			if (fileNames.length > 1) {
				appendSearchResultText(`\n${text}`);
			} else {
				appendSearchResultText(text);
			}
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

			if (workers.find((worker) => worker.started && !worker.doneReplacing)) {
				break;
			}

			await helpers.showInterstitialIfReady();

			terminateWorker(false);
			replacing = false;
			break;
		}

		case "done-searching": {
			e.target.doneSearching = true;

			if (workers.find((worker) => worker.started && !worker.doneSearching)) {
				break;
			}

			const showAd = results.length > 100;
			if (showAd) {
				await helpers.showInterstitialIfReady();
			}

			if (!results.length) {
				searchResult.setGhostText(strings["no result"], { row: 0, column: 0 });
			}

			searching = false;
			terminateWorker(false);
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

	if (target === $exclude.el) {
		store.exclude = $exclude.el.value;
	}

	if (target === $include.el) {
		store.include = $include.el.value;
	}

	terminateWorker();
	stopSearchIndex();
	searchVersion += 1;
	searching = false;
	newFiles = 0;
	$error.value = "";
	results.length = 0;
	$progress.value = 0;
	filesSearched.length = 0;
	resultOverview.reset();
	searchResult.setValue("");
	searchResult.setGhostText(strings["searching..."], { row: 0, column: 0 });
	clearPendingResultText();
	removeEvents();
	scheduleAutomaticIndex(IDLE_INDEX_RETRY_DELAY);
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

	const allFileJson = allFiles.map((file) => file.toJSON());
	pendingIndexFiles = allFileJson;

	let filesToSearch = allFiles;
	try {
		const indexResult = await withTimeout(
			searchIndex.query(allFileJson, search, options, forceUrls),
			INDEX_QUERY_TIMEOUT,
		);
		if (version !== searchVersion) return;
		filesToSearch = getIndexedFiles(allFiles, indexResult);
	} catch (error) {
		console.warn(
			"Search index query failed. Falling back to full scan.",
			error,
		);
	}

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
	sendMessage("search-files", filesToSearch, regex, options);
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

function getIndexedFiles(allFiles, indexResult) {
	if (!indexResult?.supported || !Array.isArray(indexResult.urls))
		return allFiles;

	const indexedUrls = new Set(indexResult.urls);
	return allFiles.filter((file) => indexedUrls.has(file.url));
}

function syncSearchIndex(files) {
	const syncKey = getIndexSyncKey(files);
	if (syncKey === lastIndexSyncKey) return;

	lastIndexSyncKey = syncKey;
	$indexStatus.value = "Search index queued";
	searchIndex.sync(files);
}

async function waitForFileListIfReady() {
	const result = await withTimeout(waitForFileList(), FILE_LIST_WAIT_TIMEOUT);
	if (result === TIMEOUT) {
		$indexStatus.value = "Scanning project files...";
	}
}

function scheduleAutomaticIndex(delay = INDEX_SYNC_DELAY) {
	clearTimeout(indexSyncTimer);

	indexSyncTimer = setTimeout(() => {
		prepareAutomaticIndex();
	}, delay);
}

function prepareAutomaticIndex() {
	waitForFileList().then(() => {
		if (searching || replacing) {
			scheduleAutomaticIndex(IDLE_INDEX_RETRY_DELAY);
			return;
		}

		const allFiles = files().filter((file) => !helpers.isBinary(file));
		if (!allFiles.length) return;
		pendingIndexFiles = allFiles.map((file) => file.toJSON());
		scheduleSearchIndexSync();
	});
}

function scheduleSearchIndexSync(delay = INDEX_SYNC_DELAY) {
	clearTimeout(indexSyncTimer);

	indexSyncTimer = setTimeout(() => {
		if (searching || replacing || !pendingIndexFiles) return;

		const files = pendingIndexFiles;
		pendingIndexFiles = null;
		syncSearchIndex(files);
	}, delay);
}

function stopSearchIndex() {
	clearTimeout(indexSyncTimer);
	indexSyncTimer = null;
	$indexStatus.value = "";
	searchIndex.stop();
}

function getIndexSyncKey(files) {
	return files
		.map(
			({ url, size = 0, modifiedDate = 0 }) =>
				`${url}:${size}:${modifiedDate || 0}`,
		)
		.join("\n");
}

function markIndexDirty(urls) {
	lastIndexSyncKey = "";
	searchIndex.markDirty(urls);
}

function updateIndexStatus(status = {}) {
	if (status.state === "indexing" && status.total) {
		$indexStatus.value =
			status.message || `Indexing ${status.indexed}/${status.total}`;
		return;
	}

	if (status.state === "error") {
		$indexStatus.value = status.message || "Search index unavailable";
		return;
	}

	if (status.state === "queued") {
		$indexStatus.value = status.message || "Search index queued";
		return;
	}

	if (status.state === "ready") {
		$indexStatus.value = status.message || "Search index ready";
		setTimeout(() => {
			if ($indexStatus.value === status.message) $indexStatus.value = "";
		}, 2500);
		return;
	}

	$indexStatus.value = "";
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
	sendMessage("replace-files", filesSearched, regex, options, replace);
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

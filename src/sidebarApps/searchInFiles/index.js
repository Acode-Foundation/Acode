import "./styles.scss";
import fsOperation from "fileSystem";
import addTouchListeners from "ace/touchHandler";
import autosize from "autosize";
import Checkbox from "components/checkbox";
import Sidebar, { preventSlide } from "components/sidebar";
import escapeStringRegexp from "escape-string-regexp";
import Reactive from "html-tag-js/reactive";
import Ref from "html-tag-js/ref";
import files, { Tree } from "lib/fileList";
import openFile from "lib/openFile";
import settings from "lib/settings";
import helpers from "utils/helpers";
import { fileNames, words } from "./searchResultMode";

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

let useIncludeAndExclude = false;
/**@type {AceAjax.Editor} */
let searchResult = null;
let replacing = false;
let newFiles = 0;
let searching = false;

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
	searchResult = ace.edit($el, {
		readOnly: true,
		useWorker: false,
		showLineNumbers: false,
		fontSize: "14px",
		mode: "ace/mode/search_result",
	});
	searchResult.focus = () => {};
	$container.style.lineHeight = "1.5";
	searchResult.session.setTabSize(1);
	searchResult.renderer.setMargin(0, 0, -20, 0);
	addTouchListeners(searchResult, true, onCursorChange);
	searchResult.session.setUseWrapMode(true);
};

preventSlide((target) => {
	return $container.el?.contains(target);
});

export default [
	"search",
	"searchInFiles",
	strings["search in files"],
	(/**@type {HTMLElement} */ el) => {
		el.classList.add("search-in-files");

		el.content = (
			<>
				<div className="header">
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
					<Details>
						<Summary>
							<Textarea
								ref={$search}
								type="search"
								name="search"
								placeholder={strings["search"]}
							/>
						</Summary>
						<div>
							<button
								ref={$btnReplaceAll}
								className="icon replace_all"
							></button>
							<Textarea
								ref={$replace}
								type="search"
								name="replace"
								placeholder={strings["replace"]}
							/>
						</div>
					</Details>
					<Details
						onexpand={(expanded) => {
							useIncludeAndExclude = expanded;
							if ($exclude.value || $include.value) {
								onInput();
							}
						}}
					>
						<Summary marker={false} className="extras">
							...
						</Summary>
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
					</Details>
				</div>
				<div className="search-result">
					<span ref={$resultOverview} innerHTML={searchResultText(0, 0)}></span>{" "}
					({$progress}%)
				</div>
				<div className="error">{$error}</div>
				<div
					ref={$container}
					className="search-in-file-editor editor-container"
				></div>
			</>
		);
	},
	false, // show as first item
	() => {
		searchResult?.resize(true);
	},
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
			let content;
			let readError;

			const editorFile = editorManager.getFile(data, "uri");
			if (editorFile) {
				content = editorFile.session?.getValue() || "";
			} else {
				try {
					content = await fsOperation(data).readFile(
						settings.value.defaultFileEncoding,
					);
				} catch (er) {
					readError = er;
				}
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

			fileNames.push(escapeStringRegexp(file.name));
			forceTokenizer();
			for (const result of matches) {
				result.file = index;
				results.push(result);
				if (!words.includes(result.renderText)) {
					words.push(escapeStringRegexp(result.renderText));
					forceTokenizer();
				}
			}

			searchResult.navigateFileEnd();
			if (fileNames.length > 1) {
				searchResult.insert(`\n${text}`);
			} else {
				searchResult.insert(text);
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

			if (IS_FREE_VERSION && (await window.iad?.isLoaded())) {
				window.iad.show();
			}

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
			if (IS_FREE_VERSION && showAd && (await window.iad?.isLoaded())) {
				window.iad.show();
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
	searching = false;
	newFiles = 0;
	$error.value = "";
	results.length = 0;
	$progress.value = 0;
	filesSearched.length = 0;
	resultOverview.reset();
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

	const allFiles = files();
	editorManager.files.forEach((file) => {
		const exists = allFiles.find((f) => f.url === file.uri);
		if (exists) return;

		allFiles.push(new Tree(file.name, file.uri, false));
	});

	if (!allFiles.length) {
		searchResult.removeGhostText();
		$progress.value = 100;
		return;
	}

	searching = true;
	words.length = 0;
	fileNames.length = 0;
	searchResult.setGhostText(strings["searching..."], { row: 0, column: 0 });
	sendMessage("search-files", allFiles, regex, options);
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

	const len = navigator.hardwareConcurrency - 1 || 2;

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
	return new Worker(new URL("./worker.js", import.meta.url));
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
function Details({ onexpand }, children) {
	if (onexpand) onexpand(false);
	return (
		<div onexpand={onexpand} attr-is="details">
			{children}
		</div>
	);
}

/**
 * A function component that returns a div element that functions as a summary.
 *
 * @param {Object} props - The properties object for the component.
 * @param {boolean} props.marker - Indicator whether a marker should be included in the div.
 * @param {string} props.className - CSS class name to be applied to the div.
 * @param {Array} children - An array of child elements to be inserted into the div.
 *
 * @returns {HTMLDivElement} A div element with a 'summary' attribute, a marker (if specified), and any child elements.
 */
function Summary({ marker = true, className }, children) {
	return (
		<div onclick={toggle} attr-is="summary" className={className}>
			{marker && <span className="marker"></span>}
			{children}
		</div>
	);

	/**
	 * A function that toggles the 'open' attribute on the parent element of the div
	 * and calls the onexpand function of the parent element if it exists.
	 *
	 * @this {HTMLElement} The div element that the function is bound to.
	 * @param {MouseEvent} e - The event object from the click event.
	 */
	function toggle(e) {
		if (
			e.target instanceof HTMLInputElement ||
			e.target instanceof HTMLTextAreaElement ||
			e.target instanceof HTMLSelectElement ||
			e.target.contentEditable === "true"
		)
			return;

		const $details = this.parentElement;

		$details.toggleAttribute("open");
		if ($details.hasAttribute("open")) {
			$details.onexpand?.(true);
		} else {
			$details.onexpand?.(false);
		}
	}
}

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
async function onCursorChange() {
	const line = searchResult.selection.getCursor().row;
	const result = results[line];
	if (!result) return;
	const { file, position } = result;
	if (!position) {
		// fold the file
		searchResult.execCommand("toggleFoldWidget");
		return;
	}

	Sidebar.hide();
	const { url } = filesSearched[file];
	await openFile(url, { render: true });
	const { editor } = editorManager;
	editor.moveCursorTo(position.start.row, position.start.column, false);
	editor.selection.setRange(position);
	editor.centerSelection();
	editor.focus();
}

/**
 * When a file is added or removed from the file list
 * @param {import('lib/fileList').Tree} tree
 */
function onFileUpdate(tree) {
	if (!tree || tree?.children) return;
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
	editorManager.on("rename-file", onInput);
	editorManager.on("file-content-changed", onInput);
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
	editorManager.off("rename-file", onInput);
	editorManager.off("file-content-changed", onInput);
}

function forceTokenizer() {
	const { session } = searchResult;
	// force recreation of tokenizer
	session.$mode.$tokenizer = null;
	session.bgTokenizer.setTokenizer(session.$mode.getTokenizer());
	// force re-highlight whole document
	const row = session.getLength() - 1;
	session.bgTokenizer.start(row);
}

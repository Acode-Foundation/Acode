import quickTools from "components/quickTools";
import actionStack from "lib/actionStack";
import searchHistory from "lib/searchHistory";
import appSettings from "lib/settings";
import searchSettings from "settings/searchSettings";
import KeyboardEvent from "utils/keyboardEvent";

/**@type {HTMLInputElement | HTMLTextAreaElement} */
let input;

const state = {
	shift: false,
	alt: false,
	ctrl: false,
	meta: false,
};

const events = {
	shift: [],
	alt: [],
	ctrl: [],
	meta: [],
};

/**
 * @typedef { 'shift' | 'alt' | 'ctrl' | 'meta' } QuickToolsEvent
 * @typedef {(value: boolean)=>void} QuickToolsEventListener
 */

quickTools.$input.addEventListener("input", (e) => {
	const key = e.target.value.toUpperCase();
	quickTools.$input.value = "";
	if (!key || key.length > 1) return;
	const keyCombination = getKeys({ key });

	if (keyCombination.shiftKey && !keyCombination.ctrlKey) {
		resetKeys();
		editorManager.editor.insert(shiftKeyMapping(key));
		return;
	}

	const event = KeyboardEvent("keydown", keyCombination);
	input = input || editorManager.editor.textInput.getElement();

	resetKeys();
	input.dispatchEvent(event);
});

quickTools.$input.addEventListener("keydown", (e) => {
	const { keyCode, key, which } = e;
	const keyCombination = getKeys({ keyCode, key, which });

	if (
		!["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown"].includes(
			keyCombination.key,
		)
	)
		return;
	e.preventDefault();

	const event = KeyboardEvent("keydown", keyCombination);
	if (input && input !== quickTools.$input) {
		input.dispatchEvent(event);
	} else {
		// Otherwise fallback to editor input
		editorManager.editor.textInput.getElement().dispatchEvent(event);
	}
});

appSettings.on("update:quicktoolsItems:after", () => {
	setTimeout(() => {
		if (actionStack.has("search-bar")) return;
		const { $footer, $row1, $row2 } = quickTools;
		const height = getFooterHeight();
		$footer.content = [$row1, $row2].slice(0, height);
	}, 100);
});

// Initialize history navigation
function setupHistoryNavigation() {
	const { $searchInput, $replaceInput } = quickTools;

	// Search input history navigation
	if ($searchInput.el) {
		$searchInput.el.addEventListener("keydown", (e) => {
			if (e.key === "ArrowUp") {
				e.preventDefault();
				const newValue = searchHistory.navigateSearchUp($searchInput.el.value);
				$searchInput.el.value = newValue;
				// Trigger search
				if (newValue) find(0, false);
			} else if (e.key === "ArrowDown") {
				e.preventDefault();
				const newValue = searchHistory.navigateSearchDown(
					$searchInput.el.value,
				);
				$searchInput.el.value = newValue;
				// Trigger search
				if (newValue) find(0, false);
			} else if (e.key === "Enter" || e.key === "Escape") {
				// Reset navigation on enter or escape
				searchHistory.resetSearchNavigation();
			}
		});

		// Reset navigation when user starts typing
		$searchInput.el.addEventListener("input", () => {
			searchHistory.resetSearchNavigation();
		});
	}

	// Replace input history navigation
	if ($replaceInput.el) {
		$replaceInput.el.addEventListener("keydown", (e) => {
			if (e.key === "ArrowUp") {
				e.preventDefault();
				const newValue = searchHistory.navigateReplaceUp(
					$replaceInput.el.value,
				);
				$replaceInput.el.value = newValue;
			} else if (e.key === "ArrowDown") {
				e.preventDefault();
				const newValue = searchHistory.navigateReplaceDown(
					$replaceInput.el.value,
				);
				$replaceInput.el.value = newValue;
			} else if (e.key === "Enter" || e.key === "Escape") {
				// Reset navigation on enter or escape
				searchHistory.resetReplaceNavigation();
			}
		});

		// Reset navigation when user starts typing
		$replaceInput.el.addEventListener("input", () => {
			searchHistory.resetReplaceNavigation();
		});
	}
}

export const key = {
	get shift() {
		return state.shift;
	},
	get alt() {
		return state.alt;
	},
	get ctrl() {
		return state.ctrl;
	},
	get meta() {
		return state.meta;
	},
	/**
	 * Add listener when key changes
	 * @param {QuickToolsEvent} event QuickTools event
	 * @param {QuickToolsEventListener} callback Callback to call when key changes
	 */
	on(event, callback) {
		events[event].push(callback);
	},
	/**
	 * Remove listener
	 * @param {QuickToolsEvent} event QuickTools event
	 * @param {QuickToolsEventListener} callback Callback to remove
	 */
	off(event, callback) {
		events[event] = events[event].filter((cb) => cb !== callback);
	},
};

/**
 * Performs quick actions
 * @param {string} action Action to perform
 * @param {string} value Value for the action
 * @returns {boolean} Whether the action was performed
 */
export default function actions(action, value) {
	const { editor } = editorManager;
	const { $input, $replaceInput } = quickTools;

	if (Object.keys(state).includes(action)) {
		setInput();
		value = !state[action];
		state[action] = value;
		events[action].forEach((cb) => cb(value));
		if (Object.values(state).includes(true)) {
			$input.focus();
		} else if (input) {
			input.focus();
		} else {
			$input.blur();
		}

		return value;
	}

	switch (action) {
		case "insert":
			editor.insert(value);
			return true;

		case "command":
			editor.execCommand(value);
			return true;

		case "key": {
			value = Number.parseInt(value, 10);
			const event = KeyboardEvent("keydown", getKeys({ keyCode: value }));
			if (value > 40 && value < 37) {
				resetKeys();
			}
			setInput();
			input.dispatchEvent(event);
			return true;
		}

		case "search":
			toggleSearch();
			return actionStack.has("search-bar");

		case "toggle":
			toggle();
			return true;

		case "set-height":
			if (typeof value === "object") {
				setHeight(value.height, value.save);
			} else {
				setHeight(value);
			}
			return true;

		case "search-prev":
			if (quickTools.$searchInput.el.value) {
				searchHistory.addToHistory(quickTools.$searchInput.el.value);
			}
			find(1, true);
			return true;

		case "search-next":
			if (quickTools.$searchInput.el.value) {
				searchHistory.addToHistory(quickTools.$searchInput.el.value);
			}
			find(1, false);
			return true;

		case "search-settings":
			searchSettings().show();
			return true;

		case "search-replace":
			if ($replaceInput.value) {
				searchHistory.addToHistory($replaceInput.value);
			}
			editor.replace($replaceInput.value || "");
			return true;

		case "search-replace-all":
			if ($replaceInput.value) {
				searchHistory.addToHistory($replaceInput.value);
			}
			editor.replaceAll($replaceInput.value || "");
			return true;

		default:
			return false;
	}
}

function setInput() {
	const { activeElement } = document;
	if (
		!activeElement ||
		activeElement === quickTools.$input ||
		activeElement === document.body
	)
		return;
	input = activeElement;
}

function toggleSearch() {
	const $footer = quickTools.$footer;
	const $searchRow1 = quickTools.$searchRow1;
	const $searchRow2 = quickTools.$searchRow2;
	const $searchInput = quickTools.$searchInput.el;
	const $toggler = quickTools.$toggler;
	const { editor } = editorManager;
	const selectedText = editor.getSelectedText();

	if (!$footer.contains($searchRow1)) {
		const { className } = quickTools.$toggler;
		const $content = [...$footer.children];
		const footerHeight = getFooterHeight();

		$toggler.className = "floating icon clearclose";
		$footer.content = [$searchRow1, $searchRow2];
		$searchInput.value = selectedText || "";

		$searchInput.oninput = function (e) {
			if (this.value) find(0, false);
		};

		$searchInput.onsearch = function () {
			if (this.value) {
				searchHistory.addToHistory(this.value);
				find(1, false);
			}
		};

		// Setup history navigation for search inputs
		setupHistoryNavigation();

		setFooterHeight(2);
		find(0, false);

		actionStack.push({
			id: "search-bar",
			action: () => {
				removeSearch();
				$footer.content = $content;
				$toggler.className = className;
				setFooterHeight(footerHeight);
			},
		});
	} else {
		const inputValue = $searchInput?.value || "";
		if (inputValue !== selectedText) {
			$searchInput.value = selectedText;
			find(0, false);
			return;
		}

		actionStack.get("search-bar").action();
	}

	$searchInput.focus();
	editor.resize(true);
}

function toggle() {
	// if search is active, remove it
	const searchBar = actionStack.get("search-bar");
	if (searchBar?.action) {
		searchBar.action();
		return;
	}

	const $footer = quickTools.$footer;
	const $row1 = quickTools.$row1;
	const $row2 = quickTools.$row2;

	if (!$footer.contains($row1)) {
		setHeight();
	} else if (!$footer.contains($row2)) {
		setHeight(2);
	} else {
		setHeight(0);
	}
	focusEditor();
}

function setHeight(height = 1, save = true) {
	const { $footer, $row1, $row2 } = quickTools;
	const { editor } = editorManager;

	setFooterHeight(height);
	if (save) {
		appSettings.update({ quickTools: height }, false);
	}
	editor.resize(true);

	if (!height) {
		$row1.remove();
		$row2.remove();
		return;
	}

	if (height >= 1) {
		$row1.style.scrollBehavior = "unset";
		$footer.append($row1);
		$row1.scrollLeft = Number.parseInt(
			localStorage.quickToolRow1ScrollLeft,
			10,
		);
		--height;
	}

	if (height >= 1) {
		$row2.style.scrollBehavior = "unset";
		$footer.append($row2);
		$row2.scrollLeft = Number.parseInt(
			localStorage.quickToolRow2ScrollLeft,
			10,
		);
		--height;
	}
}

/**
 * Removes search bar from footer
 */
function removeSearch() {
	const { $footer, $searchRow1, $searchRow2 } = quickTools;

	if (!$footer.contains($searchRow1)) return;
	actionStack.remove("search-bar");
	$footer.removeAttribute("data-searching");
	$searchRow1.remove();
	$searchRow2.remove();

	// Reset history navigation when search is closed
	searchHistory.resetAllNavigation();

	const { activeFile } = editorManager;

	// Check if current tab is a terminal
	if (
		activeFile &&
		activeFile.type === "terminal" &&
		activeFile.terminalComponent
	) {
		activeFile.terminalComponent.searchAddon?.clearDecorations();
		activeFile.terminalComponent.searchAddon?.clearActiveDecoration();
		return;
	}
	focusEditor();
}

/**
 * Finds the next/previous search result
 * @param {number} skip Number of search results to skip
 * @param {boolean} backward Whether to search backward
 */
function find(skip, backward) {
	const { $searchInput } = quickTools;
	const { activeFile } = editorManager;

	// Check if current tab is a terminal
	if (
		activeFile &&
		activeFile.type === "terminal" &&
		activeFile.terminalComponent
	) {
		activeFile.terminalComponent.search($searchInput.value, skip, backward);
	} else {
		// Use ACE editor search for regular files
		editorManager.editor.find($searchInput.value, {
			skipCurrent: skip,
			...appSettings.value.search,
			backwards: backward,
		});
	}

	updateSearchState();
}

function updateSearchState() {
	const MAX_COUNT = 999;
	const { activeFile } = editorManager;
	const { $searchPos, $searchTotal } = quickTools;

	// Check if current tab is a terminal
	if (activeFile && activeFile.type === "terminal") {
		// For terminal, we can't easily count all matches like in ACE editor
		// xterm search addon doesn't provide this information
		// So we just show a generic indicator
		$searchTotal.textContent = "?";
		$searchPos.textContent = "?";
		return;
	}

	// Use ACE editor search state for regular files
	const { editor } = editorManager;
	let regex = editor.$search.$options.re;
	let all = 0;
	let before = 0;
	if (regex) {
		const value = editor.getValue();
		const offset = editor.session.doc.positionToIndex(editor.selection.anchor);
		let last = (regex.lastIndex = 0);
		let m;
		while ((m = regex.exec(value))) {
			all++;
			last = m.index;
			if (last <= offset) before++;
			if (all > MAX_COUNT) break;
			if (!m[0]) {
				regex.lastIndex = last += 1;
				if (last >= value.length) break;
			}
		}
	}
	$searchTotal.textContent = all > MAX_COUNT ? "999+" : all;
	$searchPos.textContent = before;
}

/**
 * Sets the height of the footer
 * @param {number} height Height of the footer
 * @returns {void}
 */
function setFooterHeight(height) {
	const { $toggler, $footer, $searchRow1 } = quickTools;
	if (height) root.setAttribute("footer-height", height);
	else root.removeAttribute("footer-height");

	if ($toggler.classList.contains("clearclose")) return;

	if (height > 1 && !$footer.contains($searchRow1)) {
		$toggler.classList.remove("keyboard_arrow_up");
		$toggler.classList.add("keyboard_arrow_down");
	} else {
		$toggler.classList.remove("keyboard_arrow_down");
		$toggler.classList.add("keyboard_arrow_up");
	}
}

function getFooterHeight() {
	return Number.parseInt(root.getAttribute("footer-height")) || 0;
}

function focusEditor() {
	const { editor, activeFile } = editorManager;
	if (activeFile.focused) {
		editor.focus();
	}
}

function resetKeys() {
	state.shift = false;
	events.shift.forEach((cb) => cb(false));
	state.alt = false;
	events.alt.forEach((cb) => cb(false));
	state.ctrl = false;
	events.ctrl.forEach((cb) => cb(false));
	state.meta = false;
	events.meta.forEach((cb) => cb(false));
	input.focus();
}

/**
 * Gets the current state of the modifier keys
 * @param {object} key Key object
 * @param {int} [key.keyCode] Key code
 * @param {string} [key.key] Key
 * @returns {KeyboardEventInit}
 */
export function getKeys(key = {}) {
	return {
		...key,
		shiftKey: state.shift,
		altKey: state.alt,
		ctrlKey: state.ctrl,
		metaKey: state.meta,
	};
}

function shiftKeyMapping(char) {
	switch (char) {
		case "1":
			return "!";
		case "2":
			return "@";
		case "3":
			return "#";
		case "4":
			return "$";
		case "5":
			return "%";
		case "6":
			return "^";
		case "7":
			return "&";
		case "8":
			return "*";
		case "9":
			return "(";
		case "0":
			return ")";
		case "-":
			return "_";
		case "=":
			return "+";
		case "[":
			return "{";
		case "]":
			return "}";
		case "\\":
			return "|";
		case ";":
			return ":";
		case "'":
			return '"';
		case ",":
			return "<";
		case ".":
			return ">";
		case "/":
			return "?";
		default:
			return char.toUpperCase();
	}
}

import "./style.scss";
import inputhints from "components/inputhints";
import keyboardHandler from "handlers/keyboard";
import actionStack from "lib/actionStack";
import restoreTheme from "lib/restoreTheme";

/**
 * @typedef {import('./inputhints').HintCallback} HintCallback
 * @typedef {import('./inputhints').HintModification} HintModification
 */

/*
Benchmark to show keyboard

When not using keyboardHideStart event;
=============================================
Time taken to remove palette: 104
index.js:177 Time taken to show keyboard: 198
index.js:178 Total time taken: 302

When using keyboardHideStart event;
=============================================
index.js:150 Time taken to remove palette: 0
index.js:177 Time taken to show keyboard: 187
index.js:178 Total time taken: 188

When not using keyboardHideStart event;
=============================================
index.js:150 Time taken to remove palette: 105
index.js:177 Time taken to show keyboard: 203
index.js:178 Total time taken: 310

When using keyboardHideStart event;
=============================================
index.js:150 Time taken to remove palette: 0
index.js:177 Time taken to show keyboard: 176
index.js:178 Total time taken: 176

This shows that using keyboardHideStart event is faster than not using it.
*/

/**
 * Opens a palette with input and hints
 * @param {(hints:HintModification)=>string[]} getList Callback to get list of hints
 * @param {()=>string} onsSelectCb Callback to call when a hint is selected
 * @param {string} placeholder Placeholder for input
 * @param {function} onremove Callback to call when palette is removed
 * @returns {void}
 */
// Track active palette for chaining
let activePalette = null;

export default function palette(getList, onsSelectCb, placeholder, onremove) {
	// Store previous palette if exists
	const previousPalette = activePalette;
	const isChained = !!previousPalette;
	/**@type {HTMLInputElement} */
	const $input = (
		<input
			onkeydown={onkeydown}
			type="search"
			placeholder={placeholder}
			enterKeyHint="go"
		/>
	);
	/**@type {HTMLElement} */
	const $mask = <div className="mask" onclick={remove} />;
	/**@type {HTMLDivElement} */
	const $palette = <div id="palette">{$input}</div>;

	// Create a palette with input and hints
	inputhints($input, generateHints, onSelect);

	// Only set the darkened theme when this is not a chained palette
	if (!isChained) {
		// Removes the darkened color from status bar and navigation bar
		restoreTheme(true);
	}

	// Remove palette when input is blurred
	$input.addEventListener("blur", remove);
	// Don't wait for input to blur when keyboard hides, remove is
	// as soon as keyboard starts to hide
	keyboardHandler.on("keyboardHideStart", remove);

	// Add to DOM
	app.append($palette, $mask);

	// If we're in a chained palette, ensure we don't lose focus
	if (isChained) {
		// Don't let any blur events from previous palette affect this one
		setTimeout(() => {
			$input.focus();
		}, 0);
	}

	// Focus input to show options
	$input.focus();

	// Trigger input event to show hints immediately
	$input.dispatchEvent(new Event("input"));

	// Add to action stack to remove on back button
	actionStack.push({
		id: "palette",
		action: remove,
	});
	// Store this palette as the active one for chaining
	activePalette = { remove };

	/**
	 * On select callback for inputhints
	 * @param {string} value
	 */
	function onSelect(value) {
		const currentPalette = { remove };
		activePalette = currentPalette;

		onsSelectCb(value);

		if (activePalette === currentPalette) {
			remove();
		}
	}

	/**
	 * Keydown event handler for input
	 * @param {KeyboardEvent} e
	 */
	function onkeydown(e) {
		if (e.key !== "Escape") return;
		remove();
	}

	/**
	 * Generates hint for inputhints
	 * @param {HintCallback} setHints Set hints callback
	 * @param {HintModification} hintModification Hint modification object
	 */
	async function generateHints(setHints, hintModification) {
		const list = getList(hintModification);
		const data = list instanceof Promise ? await list : list;
		setHints(data);
	}

	/**
	 * Removes the palette
	 */
	function remove() {
		actionStack.remove("palette");
		keyboardHandler.off("keyboardHideStart", remove);
		$input.removeEventListener("blur", remove);

		$palette.remove();
		$mask.remove();

		// Restore previous palette if chained
		if (isChained && previousPalette) {
			activePalette = previousPalette;
		} else {
			activePalette = null;
			restoreTheme();
		}

		if (typeof onremove === "function") {
			onremove();
			return;
		}

		// If not chained or last in chain, focus the editor
		if (!isChained) {
			const { activeFile, editor } = editorManager;
			if (activeFile.wasFocused) {
				editor.focus();
			}
		}

		remove = () => {
			window.log("warn", "Palette already removed.");
		};
	}
}

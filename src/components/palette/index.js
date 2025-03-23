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
export default function palette(getList, onsSelectCb, placeholder, onremove) {
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

	// Removes the darkened color from status bar and navigation bar
	restoreTheme(true);

	// Remove palette when input is blurred
	$input.addEventListener("blur", remove);
	// Don't wait for input to blur when keyboard hides, remove is
	// as soon as keyboard starts to hide
	keyboardHandler.on("keyboardHideStart", remove);

	// Add to DOM
	app.append($palette, $mask);

	// Focus input to show options
	$input.focus();

	// Add to action stack to remove on back button
	actionStack.push({
		id: "palette",
		action: remove,
	});

	/**
	 * On select callback for inputhints
	 * @param {string} value
	 */
	function onSelect(value) {
		remove();
		setTimeout(() => {
			onsSelectCb(value);
		}, 0);
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
		let data = list instanceof Promise ? await list : list;
		setHints(data);
	}

	/**
	 * Removes the palette
	 */
	function remove() {
		actionStack.remove("palette");
		keyboardHandler.off("keyboardHideStart", remove);
		$input.removeEventListener("blur", remove);

		restoreTheme();
		$palette.remove();
		$mask.remove();

		if (typeof onremove === "function") {
			onremove();
			return;
		}

		const { activeFile, editor } = editorManager;
		if (activeFile.wasFocused) {
			editor.focus();
		}

		remove = () => {
			window.log("warn", "Palette already removed.");
		};
	}
}

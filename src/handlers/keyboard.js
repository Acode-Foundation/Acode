import {
	getSystemConfiguration,
	HARDKEYBOARDHIDDEN_NO,
} from "lib/systemConfiguration";
import KeyboardEvent from "utils/keyboardEvent";
import windowResize from "./windowResize";

/**
 * Keyboard event list
 * @typedef {'key'|'keyboardShow'|'keyboardHide'|'keyboardShowStart'|'keyboardHideStart'} KeyboardEventName
 */

// Assuming that keyboard height is at least 200px
let MIN_KEYBOARD_HEIGHT = 100;
const event = {
	key: [],
	keyboardShow: [],
	keyboardHide: [],
	keyboardShowStart: [],
	keyboardHideStart: [],
};

let escKey = false;
let escResetTimeout = null;
let softKeyboardHeight = 0;
let windowHeight = window.innerHeight;
let currentWindowHeight = windowHeight;

export const keydownState = {
	/**
	 * Get esc key state
	 * @returns {boolean}
	 */
	get esc() {
		return escKey;
	},
	/**
	 * Set esc key state
	 * @param {boolean} val
	 */
	set esc(val) {
		escKey = val;
		if (!val) return;
		clearTimeout(escResetTimeout);
		escResetTimeout = setTimeout(() => {
			escKey = false;
		}, 500);
	},
};

/**
 * Handles keyboard events
 * @param {KeyboardEvent} e
 */
export default function keyboardHandler(e) {
	const $target = e.target;
	const { key, ctrlKey, shiftKey, altKey, metaKey } = e;

	if ($target instanceof HTMLTextAreaElement) {
		keydownState.esc = key === "Escape";
		return;
	}

	if (!ctrlKey && !shiftKey && !altKey && !metaKey) return;
	if (["Control", "Alt", "Meta", "Shift"].includes(key)) return;

	const event = KeyboardEvent("keydown", {
		key,
		ctrlKey,
		shiftKey,
		altKey,
		metaKey,
	});
	const editor = editorManager.editor.textInput.getElement();
	editor.dispatchEvent(event);
}

document.addEventListener("admob.banner.size", async (event) => {
	const { height } = event.size;
	MIN_KEYBOARD_HEIGHT = height + 10;
});

windowResize.on("resizeStart", async () => {
	const { keyboardHeight, hardKeyboardHidden } = await getSystemConfiguration();
	const externalKeyboard = hardKeyboardHidden === HARDKEYBOARDHIDDEN_NO;

	if (currentWindowHeight > window.innerHeight) {
		// height decreasing
		softKeyboardHeight =
			keyboardHeight > MIN_KEYBOARD_HEIGHT ? keyboardHeight : 0;
		if (!externalKeyboard && softKeyboardHeight) {
			emit("keyboardShowStart");
		}
	} else if (currentWindowHeight < window.innerHeight) {
		// height increasing
		if (!externalKeyboard && softKeyboardHeight) {
			emit("keyboardHideStart");
		}
	}

	currentWindowHeight = window.innerHeight;
});

windowResize.on("resize", async () => {
	currentWindowHeight = window.innerHeight;

	if (currentWindowHeight > windowHeight) {
		windowHeight = currentWindowHeight;
	}

	const { hardKeyboardHidden } = await getSystemConfiguration();
	const externalKeyboard = hardKeyboardHidden === HARDKEYBOARDHIDDEN_NO;

	if (externalKeyboard || !softKeyboardHeight) return;

	const keyboardHiddenYes = windowHeight <= window.innerHeight;

	if (keyboardHiddenYes) {
		emit("keyboardHide");
	} else {
		emit("keyboardShow");
	}

	focusBlurEditor(keyboardHiddenYes);
	showHideAd(keyboardHiddenYes);
});

/**
 * Add event listener for keyboard event.
 * @param {KeyboardEventName} eventName
 * @param {Function} callback
 * @returns
 */
keyboardHandler.on = (eventName, callback) => {
	if (!event[eventName]) return;
	event[eventName].push(callback);
};

/**
 * Remove event listener for keyboard event.
 * @param {KeyboardEventName} eventName
 * @param {Function} callback
 * @returns
 */
keyboardHandler.off = (eventName, callback) => {
	if (!event[eventName]) return;
	event[eventName] = event[eventName].filter((cb) => cb !== callback);
};

/**
 * Emit keyboard event.
 * @param {KeyboardEventName} eventName
 * @returns
 */
function emit(eventName) {
	if (!event[eventName]) return;
	event[eventName].forEach((cb) => cb());
}

/**
 * Focus the editor if keyboard is visible, blur it otherwise.
 * @param {boolean} keyboardHidden
 * @returns
 */
function focusBlurEditor(keyboardHidden) {
	if (keyboardHidden) {
		document.activeElement?.blur();
	}
}

/**
 * Show ad if keyboard is hidden and ad is active, hide ad otherwise.
 * @param {boolean} keyboardHidden
 */
function showHideAd(keyboardHidden) {
	const bannerIsActive = !!window.ad?.active;

	if (!keyboardHidden && bannerIsActive) {
		window.ad?.hide();
	} else if (bannerIsActive) {
		window.ad?.show();
	}
}

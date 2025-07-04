export const HARDKEYBOARDHIDDEN_NO = 1;
export const HARDKEYBOARDHIDDEN_YES = 2;
export const HARDKEYBOARDHIDDEN_UNDEFINED = 0;

export const KEYBOARDHIDDEN_NO = 1;
export const KEYBOARDHIDDEN_YES = 2;
export const KEYBOARDHIDDEN_UNDEFINED = 0;

export const KEYBOARD_12KEY = 3;
export const KEYBOARD_QWERTY = 2;
export const KEYBOARD_UNDEFINED = 0;
export const KEYBOARD_NOKEYS = 1;

export const NAVIGATIONHIDDEN_NO = 1;
export const NAVIGATIONHIDDEN_YES = 2;
export const NAVIGATIONHIDDEN_UNDEFINED = 0;

export const NAVIGATION_DPAD = 2;
export const NAVIGATION_TRACKBALL = 3;
export const NAVIGATION_WHEEL = 4;
export const NAVIGATION_UNDEFINED = 0;

export const ORIENTATION_LANDSCAPE = 2;
export const ORIENTATION_PORTRAIT = 1;
export const ORIENTATION_SQUARE = 3;
export const ORIENTATION_UNDEFINED = 0;

export const TOUCHSCREEN_FINGER = 3;
export const TOUCHSCREEN_NOTOUCH = 1;
export const TOUCHSCREEN_STYLUS = 2;
export const TOUCHSCREEN_UNDEFINED = 0;

/**
 * @typedef {Object} SystemConfiguration
 * @property {number} hardKeyboardHidden
 * @property {number} navigationHidden
 * @property {number} keyboardHidden
 * @property {number} keyboardHeight
 * @property {number} orientation
 * @property {number} navigation
 * @property {number} fontScale
 * @property {number} keyboard
 * @property {string} locale
 */

/**
 * Get the system configuration
 * @returns {Promise<SystemConfiguration>}
 */
export function getSystemConfiguration() {
	return new Promise((resolve, reject) => {
		cordova.exec(resolve, reject, "System", "get-configuration", []);
	});
}

export function isDeviceDarkTheme() {
	return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

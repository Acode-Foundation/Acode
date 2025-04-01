import confirm from "dialogs/confirm";
import appSettings from "lib/settings";

const stack = [];
let mark = null;
let onCloseAppCallback;
let freeze = false;

export default {
	/**
	 * Length of stack
	 * @returns {number}
	 */
	get length() {
		return stack.length;
	},
	/**
	 * Function to be called when app is closed
	 * @returns {Function}
	 */
	get onCloseApp() {
		return onCloseAppCallback;
	},
	/**
	 * Function to be called when app is closed
	 * @param {Function} cb
	 */
	set onCloseApp(cb) {
		onCloseAppCallback = cb;
	},
	/**
	 * Copy of actionStack for window
	 * @deprecated
	 */
	windowCopy() {
		const copyStack = { ...this };
		delete copyStack.windowCopy;
		copyStack.pop = (repeat) => {
			window.log(
				"error",
				"Deprecated: `window.actionStack` is deprecated, import `actionStack` instead",
			);
			this.pop(repeat);
		};
		return copyStack;
	},
	/**
	 * Push action to stack
	 * @param {object} fun
	 * @param {string} fun.id
	 * @param {Function} fun.action
	 */
	push(fun) {
		stack.push(fun);
	},
	/**
	 * Pop action from stack
	 * @param {number} repeat pop action multiple times
	 * @returns
	 */
	async pop(repeat) {
		if (freeze) return;
		let confirmation = true;

		if (typeof repeat === "number" && repeat > 1) {
			for (let i = 0; i < repeat; ++i) {
				this.pop();
			}
			return;
		}

		const fun = stack.pop();

		if (fun) {
			fun.action();
			return;
		}

		if (appSettings.value.confirmOnExit) {
			const closeMessage =
				acode.exitAppMessage || strings["close app"].capitalize(0);
			confirmation = await confirm(strings.warning.toUpperCase(), closeMessage);
		}

		if (confirmation) {
			const { exitApp } = navigator.app;

			if (typeof onCloseAppCallback === "function") {
				const res = onCloseAppCallback();
				if (res instanceof Promise) {
					res.finally(exitApp);
					return;
				}
			}

			if (IS_FREE_VERSION && window.iad?.isLoaded()) {
				window.iad.show();
			}

			exitApp();
		}
	},
	get(id) {
		return stack.find((act) => act.id === id);
	},
	/**
	 * Remove action with given id from stack
	 * @param {String} id
	 * @returns {Boolean}
	 */
	remove(id) {
		for (let i = 0; i < stack.length; ++i) {
			const action = stack[i];
			if (action.id === id) {
				stack.splice(i, 1);
				return true;
			}
		}

		return false;
	},
	/**
	 * Check if action with given id exists in stack
	 * @param {String} id
	 * @returns {Boolean}
	 */
	has(id) {
		for (const act of stack) if (act.id === id) return true;
		return false;
	},
	/**
	 * Sets a mark to recently pushed action
	 */
	setMark() {
		mark = stack.length;
	},
	/**
	 * Remove all actions that are pushed after marked positions (using `setMark()`)
	 */
	clearFromMark() {
		if (mark === null) return;
		stack.splice(mark);
		mark = null;
	},
	freeze() {
		freeze = true;
	},
	unfreeze() {
		freeze = false;
	},
};

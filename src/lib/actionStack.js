import confirm from "dialogs/confirm";
import platform from "lib/platform";
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
	 * @param {() => void} [fun.onClear] Synchronous cleanup on bulk removal; must not return a Promise.
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
		if (!platform.appExit) return;

		if (appSettings.value.confirmOnExit) {
			let closeMessage =
				acode.exitAppMessage || strings["close app"].capitalize(0);
			confirmation = await confirm(strings.warning, closeMessage);
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
			let action = stack[i];
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
		for (let act of stack) if (act.id === id) return true;
		return false;
	},
	/**
	 * Sets a mark to recently pushed action
	 */
	setMark() {
		mark = stack.length;
	},
	/**
	 * Remove the marked entries, reset the mark, then run onClear callbacks top-first.
	 * Cleanup must be synchronous: returned Promises are neither awaited nor caught.
	 * Callbacks should avoid stack mutations unless deliberate; newly pushed entries
	 * and new marks survive this clear.
	 */
	clearFromMark() {
		if (mark === null) return;
		const removed = stack.splice(mark);
		mark = null;
		for (const entry of removed.reverse()) {
			try {
				entry.onClear?.();
			} catch (error) {
				console.error(error);
			}
		}
	},
	freeze() {
		freeze = true;
	},
	unfreeze() {
		freeze = false;
	},
};

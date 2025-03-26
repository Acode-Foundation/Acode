let resizeTimeout;

/**
 * @typedef {'resize'|'resizeStart'} ResizeEventName
 */

const event = {
	resize: [],
	resizeStart: [],
};

/**
 * *external keyboard*
 * -> config.hardKeyboardHidden = HARDKEYBOARDHIDDEN_NO
 * This means that external keyboard is connected. If external keyboard is connected,
 * we don't need to do anything.
 *
 * *floating keyboard is active*
 * -> No way to detect this.
 *
 * *keyboard is hidden*
 * -> If window height is smaller than earlier, keyboard is visible. and vice versa.
 * If keyboard is not visible, we need to blur the editor, and hide the ad.
 * Else we need to focus the editor, and show the ad.
 */

export default function windowResize() {
	if (!resizeTimeout) {
		emit("resizeStart");
	}

	clearTimeout(resizeTimeout);
	resizeTimeout = setTimeout(onResize, 100);
}

/**
 * Add event listener for window done resizing.
 * @param {ResizeEventName} eventName
 * @param {Function} callback
 * @returns
 */
windowResize.on = (eventName, callback) => {
	if (!event[eventName]) return;
	event[eventName].push(callback);
};

/**
 * Remove event listener for window done resizing.
 * @param {ResizeEventName} eventName
 * @param {Function} callback
 * @returns
 */
windowResize.off = (eventName, callback) => {
	if (!event[eventName]) return;
	event[eventName] = event[eventName].filter((cb) => cb !== callback);
};

/**
 * Timeout function for window done resizing.
 */
function onResize() {
	resizeTimeout = null;
	emit("resize");
}

/**
 * Emit event
 * @param {ResizeEventName} eventName
 * @returns
 */
function emit(eventName) {
	if (!event[eventName]) return;
	for (const cb of event[eventName]) {
		cb();
	}
}

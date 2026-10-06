/** Temporary orientation requests for the main WebView's fullscreen session. */
export default {
	/**
	 * @param {"landscape" | "portrait"} mode
	 * @returns {Promise<void>} Resolves when the native request is accepted.
	 */
	async lock(mode) {
		if (mode !== "landscape" && mode !== "portrait") {
			throw new TypeError("Orientation must be landscape or portrait.");
		}
		await setOrientation(mode);
	},

	/** @returns {Promise<void>} Restores the previous policy, if overridden. */
	async unlock() {
		await setOrientation(null);
	},
};

function setOrientation(mode) {
	return new Promise((resolve, reject) => {
		cordova.exec(
			resolve,
			(message) => reject(new Error(message)),
			"System",
			"set-fullscreen-orientation",
			[mode],
		);
	});
}

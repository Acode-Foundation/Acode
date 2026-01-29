import fsOperation from "fileSystem";
import ajax from "@deadlyjack/ajax";
import loader from "dialogs/loader";
import helpers from "utils/helpers";
import Url from "utils/Url";
import constants from "./constants";

let erudaInstance = null;
let isInitialized = false;

/**
 * Developer tools module for debugging Acode
 */
const devTools = {
	/**
	 * Check if Eruda is initialized
	 * @returns {boolean}
	 */
	get isInitialized() {
		return isInitialized;
	},

	/**
	 * Get the Eruda instance
	 * @returns {object|null}
	 */
	get eruda() {
		return erudaInstance;
	},

	/**
	 * Initialize Eruda for developer mode
	 * @param {boolean} showLoader - Whether to show a loading dialog
	 * @returns {Promise<void>}
	 */
	async init(showLoader = false) {
		if (isInitialized) return;

		try {
			const erudaPath = Url.join(DATA_STORAGE, "eruda.js");
			const fs = fsOperation(erudaPath);

			if (!(await fs.exists())) {
				if (showLoader) {
					loader.create(
						strings["downloading file"]?.replace("{file}", "eruda.js") ||
							"Downloading eruda.js...",
						strings["downloading..."] || "Downloading...",
					);
				}

				try {
					const erudaScript = await ajax({
						url: constants.ERUDA_CDN,
						responseType: "text",
						contentType: "application/x-www-form-urlencoded",
					});
					await fsOperation(DATA_STORAGE).createFile("eruda.js", erudaScript);
				} finally {
					if (showLoader) loader.destroy();
				}
			}

			const internalUri = await helpers.toInternalUri(erudaPath);

			await new Promise((resolve, reject) => {
				const script = document.createElement("script");
				script.src = internalUri;
				script.id = "eruda-script";
				script.onload = resolve;
				script.onerror = reject;
				document.head.appendChild(script);
			});

			if (window.eruda) {
				window.eruda.init({
					useShadowDom: true,
					autoScale: true,
					defaults: {
						displaySize: 50,
					},
				});

				window.eruda._shadowRoot.querySelector(
					".eruda-entry-btn",
				).style.display = "none";

				erudaInstance = window.eruda;
				isInitialized = true;
			}
		} catch (error) {
			console.error("Failed to initialize developer tools", error);
			throw error;
		}
	},

	/**
	 * Show the inspector panel
	 */
	show() {
		if (!isInitialized) {
			window.toast?.("Developer mode is not enabled");
			return;
		}
		const entryBtn =
			erudaInstance?._shadowRoot?.querySelector(".eruda-entry-btn");
		if (entryBtn) entryBtn.style.display = "";
		erudaInstance?.show();
	},

	/**
	 * Hide the inspector panel
	 */
	hide() {
		if (!isInitialized) return;
		erudaInstance?.hide();
		const entryBtn =
			erudaInstance?._shadowRoot?.querySelector(".eruda-entry-btn");
		if (entryBtn) entryBtn.style.display = "none";
	},

	/**
	 * Toggle the inspector panel visibility
	 */
	toggle() {
		if (!isInitialized) {
			window.toast?.("Developer mode is not enabled");
			return;
		}
		if (erudaInstance?._isShow) {
			this.hide();
		} else {
			this.show();
		}
	},

	/**
	 * Destroy Eruda instance
	 */
	destroy() {
		if (!isInitialized) return;
		erudaInstance?.destroy();
		erudaInstance = null;
		isInitialized = false;
		const script = document.getElementById("eruda-script");
		if (script) script.remove();
	},
};

export default devTools;

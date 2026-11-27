import fsOperation from "fileSystem";
import loader from "dialogs/loader";
import helpers from "utils/helpers";
import Url from "utils/Url";
import config from "./config";
import { discardStartupLogs, takeStartupLogs } from "./startupLogBuffer";

let erudaInstance = null;
let isInitialized = false;
/** @type {Promise<void> | null} */
let initializing = null;
/** Bumped by destroy() so a pending initialization does not activate Eruda. */
let generation = 0;

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
	init(showLoader = false) {
		if (isInitialized) return Promise.resolve();
		if (initializing) return initializing;
		const pending = initEruda(showLoader, generation).finally(() => {
			if (initializing === pending) initializing = null;
		});
		initializing = pending;
		return pending;
	},

	/**
	 * Show the inspector panel
	 */
	async show() {
		await initializing?.catch(() => {});
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
	async toggle() {
		await initializing?.catch(() => {});
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
		generation++;
		initializing = null;
		discardStartupLogs();
		if (!isInitialized) return;
		erudaInstance?.destroy();
		erudaInstance = null;
		isInitialized = false;
		const script = document.getElementById("eruda-script");
		if (script) script.remove();
	},
};

export default devTools;

/**
 * @param {boolean} showLoader
 */
async function initEruda(showLoader, initGeneration) {
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
				const erudaScript = await fsOperation(config.ERUDA_CDN).readFile(
					"utf-8",
				);
				await fsOperation(DATA_STORAGE).createFile("eruda.js", erudaScript);
			} catch {
			} finally {
				if (showLoader) loader.destroy();
			}
		}

		const internalUri = await helpers.toInternalUri(erudaPath);

		if (initGeneration !== generation) return;
		const script = document.createElement("script");
		await new Promise((resolve, reject) => {
			script.src = internalUri;
			script.id = "eruda-script";
			script.onload = resolve;
			script.onerror = reject;
			document.head.appendChild(script);
		});

		// Developer mode was turned off while Eruda was loading.
		if (initGeneration !== generation) {
			script.remove();
			return;
		}

		if (window.eruda) {
			window.eruda.init({
				useShadowDom: true,
				autoScale: true,
				defaults: {
					displaySize: 50,
				},
			});

			window.eruda._shadowRoot.querySelector(".eruda-entry-btn").style.display =
				"none";

			erudaInstance = window.eruda;
			isInitialized = true;
			replayStartupLogs(erudaInstance);
		}
	} catch (error) {
		console.error("Failed to initialize developer tools", error);
		throw error;
	}
}

/**
 * Eruda starts after the editor is visible; show what was logged before it.
 */
function replayStartupLogs(eruda) {
	const erudaConsole = eruda.get?.("console");
	if (!erudaConsole) return;
	for (const { method, args } of takeStartupLogs()) {
		const write = erudaConsole[method] ?? erudaConsole.log;
		write.apply(erudaConsole, args);
	}
}

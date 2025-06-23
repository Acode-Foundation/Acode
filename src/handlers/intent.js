import fsOperation from "fileSystem";
import openFile from "lib/openFile";
import helpers from "utils/helpers";

const handlers = [];
/**
 * Queue to store intents that arrive before files are restored
 * @type {Array<{url: string, options: object}>}
 */
const pendingIntents = [];

/**
 *
 * @param {Intent} intent
 */
export default async function HandleIntent(intent = {}) {
	const type = intent.action.split(".").slice(-1)[0];

	if (["SEND", "VIEW", "EDIT"].includes(type)) {
		/**@type {string} */
		const url = intent.fileUri || intent.data;
		if (!url) return;

		if (url.startsWith("acode://")) {
			const path = url.replace("acode://", "");
			const [module, action, value] = path.split("/");

			let defaultPrevented = false;
			const event = new IntentEvent(module, action, value);
			for (const handler of handlers) {
				handler(event);
				if (event.defaultPrevented) defaultPrevented = true;
				if (event.propagationStopped) break;
			}

			if (defaultPrevented) return;

			if (module === "plugin") {
				const { default: Plugin } = await import("pages/plugin");
				const installed = await fsOperation(PLUGIN_DIR, value).exists();
				Plugin({ id: value, installed, install: action === "install" });
			}

			return;
		}

		if (sessionStorage.getItem("isfilesRestored") === "true") {
			await openFile(url, {
				mode: "single",
				render: true,
			});
		} else {
			// Store the intent for later processing when files are restored
			pendingIntents.push({
				url,
				options: {
					mode: "single",
					render: true,
				},
			});
		}
	}
}

HandleIntent.onError = (error) => {
	helpers.error(error);
};

export function addIntentHandler(handler) {
	handlers.push(handler);
}

export function removeIntentHandler(handler) {
	const index = handlers.indexOf(handler);
	if (index > -1) handlers.splice(index, 1);
}

/**
 * Process all pending intents that were queued before files were restored.
 * This function is called after isfilesRestored is set to true in main.js.
 * @returns {Promise<void>}
 */
export async function processPendingIntents() {
	if (sessionStorage.getItem("isfilesRestored") !== "true") return;

	// Process all pending intents
	while (pendingIntents.length > 0) {
		const pendingIntent = pendingIntents.shift();
		try {
			await openFile(pendingIntent.url, pendingIntent.options);
		} catch (error) {
			helpers.error(error);
		}
	}
}

class IntentEvent {
	module;
	action;
	value;

	#defaultPrevented = false;
	#propagationStopped = false;

	/**
	 * Creates an instance of IntentEvent.
	 * @param {string} module
	 * @param {string} action
	 * @param {string} value
	 */
	constructor(module, action, value) {
		this.module = module;
		this.action = action;
		this.value = value;
	}

	preventDefault() {
		this.#defaultPrevented = true;
	}

	stopPropagation() {
		this.#propagationStopped = true;
	}

	get defaultPrevented() {
		return this.#defaultPrevented;
	}

	get propagationStopped() {
		return this.#propagationStopped;
	}
}

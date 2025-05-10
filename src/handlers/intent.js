import fsOperation from "fileSystem";
import internalFs from "fileSystem/internalFs";
import openFile from "lib/openFile";
import helpers from "utils/helpers";

const handlers = [];

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
				const installed = await internalFs.exists(PLUGIN_DIR);
				Plugin({ id: value, installed, install: action === "install" });
			}

			return;
		}

		await openFile(url, {
			mode: "single",
			render: true,
		});
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

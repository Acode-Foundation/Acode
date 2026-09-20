import fsOperation from "fileSystem";
import select from "dialogs/select";
import auth from "lib/auth";
import config from "lib/config";
import { isInitialPluginLoadComplete } from "lib/loadPlugins";
import openFile from "lib/openFile";
import { BANNER_SUPPRESSION_REASON, setBannerSuppressed } from "lib/startAd";
import helpers from "utils/helpers";

const handlers = [];
/**
 * Batches wait for restored files and plugin handlers, then open sequentially.
 * @type {Array<{uris: string[], invalid: boolean}>}
 */
const pendingIntents = [];
let opening;

/**
 *
 * @param {Intent} intent
 */
export default async function HandleIntent(intent = {}) {
	const type = intent.action?.split(".").slice(-1)[0];

	if (["SEND", "SEND_MULTIPLE", "VIEW", "EDIT"].includes(type)) {
		/**@type {string} */
		const url =
			intent.fileUri ||
			intent.data ||
			intent.extras?.["android.intent.extra.STREAM"];
		if (typeof url === "string" && url.startsWith("acode://")) {
			const path = url.replace("acode://", "");
			const [module, action, value] = path.split("/");

			if (module === "auth" && action === "callback") {
				return;
			}

			let defaultPrevented = false;
			const event = new IntentEvent(module, action, value);
			for (const handler of handlers) {
				handler(event);
				if (event.defaultPrevented) defaultPrevented = true;
				if (event.propagationStopped) break;
			}

			if (defaultPrevented) return;

			if (module === "plugin" && action === "install") {
				const { default: Plugin } = await import("pages/plugin");

				if (!value || !/^([a-z0-9\.]+)$/.test(value)) {
					return;
				}

				const installed = await fsOperation(PLUGIN_DIR, value).exists();
				Plugin({ id: value, installed, install: action === "install" });
			}

			if (module === "pro") {
				try {
					const user = await auth.getLoggedInUser(true);
					if (user.acode_pro) {
						config.HAS_PRO = true;
						setBannerSuppressed(BANNER_SUPPRESSION_REASON.PRO, true);
						const settings = document.querySelector(
							'[data-action="list-item"][data-key="removeads"',
						);
						if (settings) {
							settings.remove();
						}
					}
				} catch (error) {}
			}

			return;
		}

		const incoming = intent.uris?.length
			? intent.uris
			: Array.isArray(url)
				? url
				: url == null
					? []
					: [url];
		if (!Array.isArray(incoming) || !incoming.length) return;
		const uris = [
			...new Set(
				incoming.filter(
					(uri) => typeof uri === "string" && /^(content|file):\/\//i.test(uri),
				),
			),
		];
		pendingIntents.push({
			uris,
			invalid: incoming.some((uri) => !uris.includes(uri)),
		});
		await processPendingIntents();
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

/** Drain only after both startup phases, including a partially failed plugin load. */
export async function processPendingIntents() {
	if (
		sessionStorage.getItem("isfilesRestored") !== "true" ||
		!isInitialPluginLoadComplete()
	)
		return;
	if (opening) return opening;
	opening = (async () => {
		while (pendingIntents.length) {
			const { uris, invalid } = pendingIntents.shift();
			const failures = invalid
				? [{ filename: strings["invalid shared file"] }]
				: [];
			for (const uri of uris) {
				try {
					await openFile(uri, {
						mode: "single",
						render: true,
						persistInSession: false,
						external: true,
					});
				} catch (error) {
					console.error("Unable to open incoming file", error);
					failures.push({
						code: error?.code,
						filename: error?.filename || uri,
					});
				}
			}
			if (failures.length)
				await reportFailures(failures).catch(HandleIntent.onError);
		}
	})().finally(() => {
		opening = undefined;
	});
	return opening;
}

async function reportFailures(failures) {
	const needsPlugin = failures.some(
		(error) => error.code === "DOCUMENT_HANDLER_UNAVAILABLE",
	);
	const explanation = needsPlugin
		? strings["document plugin required"]
		: strings["shared files unavailable"];
	// The select dialog supports rich text. Build its message as text so
	// provider filenames cannot introduce markup or links.
	const message = document.createElement("p");
	message.style.cssText =
		"white-space:pre-wrap;overflow-wrap:anywhere;margin:0";
	message.textContent = `${explanation}\n\n${failures.map((error) => error.filename).join("\n")}`;
	const answer = await new Promise((resolve, reject) => {
		select(
			strings["unable to open file"],
			[
				{ text: message.outerHTML, disabled: true },
				...(needsPlugin ? [{ value: "plugins", text: strings.plugins }] : []),
				{ value: "close", text: needsPlugin ? strings.cancel : strings.ok },
			],
			{
				default: needsPlugin ? "plugins" : "close",
				onCancel: () => resolve(null),
			},
		).then(resolve, reject);
	});
	if (answer === "plugins") acode.exec("open", "plugins");
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

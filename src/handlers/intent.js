import fsOperation from "fileSystem";
import select from "dialogs/select";
import auth from "lib/auth";
import config from "lib/config";
import fileTypeHandler from "lib/fileTypeHandler";
import { isInitialPluginLoadComplete } from "lib/loadPlugins";
import openFile, { EXTERNAL_DOCUMENT_PATTERN } from "lib/openFile";
import { BANNER_SUPPRESSION_REASON, setBannerSuppressed } from "lib/startAd";
import helpers from "utils/helpers";

/**
 * How long files opened from other apps wait for plugins at startup. After
 * this, only files a plugin may handle keep waiting for every plugin, so one
 * slow plugin no longer delays everything else.
 */
const PLUGIN_GRACE_MS = 1000;

const handlers = [];
/**
 * Batches wait for restored files and plugin handlers, then open sequentially.
 * @type {Array<{uris: string[], invalid: boolean}>}
 */
const pendingIntents = [];
let opening;
let pluginGraceElapsed = false;

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

/**
 * Starts the plugin grace period. Call it when the initial plugin load starts.
 */
export function startPluginGracePeriod() {
	setTimeout(() => {
		pluginGraceElapsed = true;
		void processPendingIntents().catch(HandleIntent.onError);
	}, PLUGIN_GRACE_MS);
}

/**
 * Drain once files are restored and either every plugin has loaded (even
 * partially failed) or the grace period is over and no pending file may need
 * a plugin handler.
 */
export async function processPendingIntents() {
	if (sessionStorage.getItem("isfilesRestored") !== "true") return;
	if (!isInitialPluginLoadComplete() && !pluginGraceElapsed) return;
	if (opening) return opening;
	opening = (async () => {
		while (pendingIntents.length) {
			// Keep the order: a file that may need a plugin holds back the rest.
			if (
				!isInitialPluginLoadComplete() &&
				(await mayNeedPluginHandler(pendingIntents[0]))
			)
				break;
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
		// Plugins may have finished while a held-back file was being checked.
		if (pendingIntents.length && isInitialPluginLoadComplete())
			void processPendingIntents().catch(HandleIntent.onError);
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

/**
 * @param {{uris: string[]}} intent
 */
async function mayNeedPluginHandler({ uris }) {
	for (const uri of uris) {
		let name;
		try {
			// Content URIs rarely carry the file name; the provider knows it.
			({ name } = await fsOperation(uri).stat());
		} catch {
			return true;
		}
		if (
			!name ||
			EXTERNAL_DOCUMENT_PATTERN.test(name) ||
			fileTypeHandler.mayHavePluginHandler(name)
		)
			return true;
	}
	return false;
}

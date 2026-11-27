import bridge from "./bridge";

/**
 * Thin, promise-based wrapper over the native AcodeWebView service. Every call
 * maps 1:1 to an action handled by WebViewPlugin.java; the instance registry,
 * event fan-out and option validation live in src/lib/webview.js.
 */
const call = bridge("AcodeWebView");
const { exec } = call;

interface MessagePayload {
	id: string;
	event?: string;
	data?: unknown;
	message?: unknown;
}
type MessageListener = (payload: MessagePayload) => void;

let messageHandler: MessageListener | null = null;
let messageCallbackRegistered = false;

export default {
	/**
	 * Registers the single, long-lived callback used for page messages and
	 * lifecycle events. Calling it again only swaps the handler; the native
	 * keep-callback channel is registered once.
	 */
	setMessageCallback(callback: MessageListener | null) {
		messageHandler = typeof callback === "function" ? callback : null;
		if (messageCallbackRegistered) return;
		messageCallbackRegistered = true;
		exec(
			(payload: MessagePayload) => messageHandler?.(payload),
			(error: unknown) =>
				console.error("WebView message callback error:", error),
			"setMessageCallback",
		);
	},
	/** Feature probes; resolves to a plain object of capability booleans. */
	capabilities: () => call<Record<string, boolean>>("capabilities"),
	create: (options: Record<string, unknown> = {}) =>
		call<string>("create", [options || {}]),
	loadURL: (id: string, url: string, headers?: Record<string, string>) =>
		call("loadURL", withOptional([id, url], headers)),
	loadHTML: (id: string, html: string, htmlOptions?: Record<string, unknown>) =>
		call("loadHTML", withOptional([id, html], htmlOptions)),
	evaluate: (id: string, code: string) => call<unknown>("evaluate", [id, code]),
	postMessage: (id: string, message: unknown) =>
		call("postMessage", [
			id,
			typeof message === "string" ? message : JSON.stringify(message),
		]),
	show: (id: string) => call("show", [id]),
	hide: (id: string) => call("hide", [id]),
	reload: (id: string) => call("reload", [id]),
	stopLoading: (id: string) => call("stopLoading", [id]),
	goBack: (id: string) => call("goBack", [id]),
	goForward: (id: string) => call("goForward", [id]),
	canGoBack: (id: string) => call<boolean>("canGoBack", [id]),
	canGoForward: (id: string) => call<boolean>("canGoForward", [id]),
	clearCache: (id: string, includeDiskFiles?: boolean) =>
		call("clearCache", [id, includeDiskFiles !== false]),
	clearHistory: (id: string) => call("clearHistory", [id]),
	clearFormData: (id: string) => call("clearFormData", [id]),
	setUserAgent: (id: string, userAgent?: string | null, mode?: string | null) =>
		call("setUserAgent", [id, userAgent ?? null, mode || null]),
	getUserAgent: (id: string) => call<string>("getUserAgent", [id]),
	updateSettings: (id: string, settings?: Record<string, unknown>) =>
		call("updateSettings", [id, settings || {}]),
	getSettings: (id: string) =>
		call<Record<string, unknown>>("getSettings", [id]),
	getInfo: (id: string) => call<Record<string, unknown>>("getInfo", [id]),
	destroy: (id: string) => call("destroy", [id]),
};

function withOptional(args: unknown[], extra?: Record<string, unknown>) {
	return extra && Object.keys(extra).length > 0 ? [...args, extra] : args;
}

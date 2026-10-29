/**
 * Thin, promise-based wrapper over the native AcodeWebView Cordova plugin.
 *
 * Every call maps 1:1 to an action handled by WebViewPlugin.java. Higher-level
 * behaviour (instance registry, event fan-out, option validation) lives in
 * src/lib/webview.js.
 */

const SERVICE = "AcodeWebView";

let messageHandler = null;
let messageCallbackRegistered = false;

/**
 * Registers the single, long-lived callback used for page messages and
 * lifecycle events. Calling it more than once only swaps the handler; the
 * native keep-callback channel is registered exactly once.
 */
function setMessageCallback(callback) {
	messageHandler = typeof callback === "function" ? callback : null;

	if (messageCallbackRegistered) return;

	messageCallbackRegistered = true;
	cordova.exec(
		(payload) => {
			if (messageHandler) {
				messageHandler(payload);
			}
		},
		(error) => {
			console.error("WebView message callback error:", error);
		},
		SERVICE,
		"setMessageCallback",
		[],
	);
}

function invoke(action, args) {
	return new Promise((resolve, reject) => {
		cordova.exec(resolve, reject, SERVICE, action, args || []);
	});
}

/** Feature probes; resolves to a plain object of capability booleans. */
function capabilities() {
	return invoke("capabilities", []);
}

function create(options) {
	return invoke("create", [options || {}]);
}

function loadURL(id, url, headers) {
	const args = [id, url];
	if (headers && Object.keys(headers).length > 0) {
		args.push(headers);
	}
	return invoke("loadURL", args);
}

function loadHTML(id, html, htmlOptions) {
	const args = [id, html];
	if (htmlOptions && Object.keys(htmlOptions).length > 0) {
		args.push(htmlOptions);
	}
	return invoke("loadHTML", args);
}

function evaluate(id, js) {
	return invoke("evaluate", [id, js]);
}

function postMessage(id, message) {
	const payload =
		typeof message === "string" ? message : JSON.stringify(message);
	return invoke("postMessage", [id, payload]);
}

function show(id) {
	return invoke("show", [id]);
}

function hide(id) {
	return invoke("hide", [id]);
}

function reload(id) {
	return invoke("reload", [id]);
}

function stopLoading(id) {
	return invoke("stopLoading", [id]);
}

function goBack(id) {
	return invoke("goBack", [id]);
}

function goForward(id) {
	return invoke("goForward", [id]);
}

function canGoBack(id) {
	return invoke("canGoBack", [id]);
}

function canGoForward(id) {
	return invoke("canGoForward", [id]);
}

function clearCache(id, includeDiskFiles) {
	return invoke("clearCache", [id, includeDiskFiles !== false]);
}

function clearHistory(id) {
	return invoke("clearHistory", [id]);
}

function clearFormData(id) {
	return invoke("clearFormData", [id]);
}

function setUserAgent(id, userAgent, mode) {
	return invoke("setUserAgent", [id, userAgent == null ? null : userAgent, mode || null]);
}

function getUserAgent(id) {
	return invoke("getUserAgent", [id]);
}

function updateSettings(id, settings) {
	return invoke("updateSettings", [id, settings || {}]);
}

function getSettings(id) {
	return invoke("getSettings", [id]);
}

function getInfo(id) {
	return invoke("getInfo", [id]);
}

function destroy(id) {
	return invoke("destroy", [id]);
}

export default {
	setMessageCallback,
	capabilities,
	create,
	loadURL,
	loadHTML,
	evaluate,
	postMessage,
	show,
	hide,
	reload,
	stopLoading,
	goBack,
	goForward,
	canGoBack,
	canGoForward,
	clearCache,
	clearHistory,
	clearFormData,
	setUserAgent,
	getUserAgent,
	updateSettings,
	getSettings,
	getInfo,
	destroy,
};

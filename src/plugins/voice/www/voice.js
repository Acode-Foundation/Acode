/**
 * Thin promise wrapper around the native AcodeVoice Cordova plugin.
 *
 * Recognition events are delivered through one long-lived callback. All
 * higher-level behaviour (listeners, permission caching, fallback) lives in
 * src/lib/voice.js.
 */

const SERVICE = "AcodeVoice";

let eventHandler = null;

function setCallback(handler) {
	eventHandler = typeof handler === "function" ? handler : null;
	cordova.exec(
		(payload) => {
			if (eventHandler) eventHandler(payload);
		},
		(error) => {
			console.error("AcodeVoice callback error:", error);
		},
		SERVICE,
		"setCallback",
		[],
	);
}

function invoke(action, args) {
	return new Promise((resolve, reject) => {
		cordova.exec(resolve, reject, SERVICE, action, args || []);
	});
}

function isAvailable() {
	return invoke("isAvailable", []);
}

function hasPermission() {
	return invoke("hasPermission", []);
}

function requestPermission() {
	return invoke("requestPermission", []);
}

function start(options) {
	return invoke("start", [options || {}]);
}

function stop() {
	return invoke("stop", []);
}

function cancel() {
	return invoke("cancel", []);
}

function getState() {
	return invoke("getState", []);
}

export default {
	setCallback,
	isAvailable,
	hasPermission,
	requestPermission,
	start,
	stop,
	cancel,
	getState,
};

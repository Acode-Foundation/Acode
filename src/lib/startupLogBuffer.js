/**
 * Records console output and uncaught errors from the moment main.js runs, so
 * developer tools can start after the editor is visible without losing the
 * startup logs. It is discarded as soon as developer mode turns out to be off.
 */

const MAX_ENTRIES = 1000;
const METHODS = ["log", "info", "warn", "error", "debug"];

/** @type {Array<{method: string, args: unknown[]}> | null} */
let entries = [];
const originals = {};
const wrappers = {};

for (const method of METHODS) {
	originals[method] = console[method];
	wrappers[method] = function (...args) {
		record(method, args);
		return originals[method].apply(this, args);
	};
	console[method] = wrappers[method];
}
window.addEventListener("error", onError);
window.addEventListener("unhandledrejection", onRejection);

/**
 * Stops recording and returns what was captured, oldest first.
 * @returns {Array<{method: string, args: unknown[]}>}
 */
export function takeStartupLogs() {
	const captured = entries ?? [];
	stop();
	return captured;
}

/** Stops recording and drops everything captured. */
export function discardStartupLogs() {
	stop();
}

function stop() {
	if (!entries) return;
	entries = null;
	for (const method of METHODS) {
		// If something wrapped console after us, ours stays as a pass-through.
		if (console[method] === wrappers[method])
			console[method] = originals[method];
	}
	window.removeEventListener("error", onError);
	window.removeEventListener("unhandledrejection", onRejection);
}

function record(method, args) {
	if (!entries) return;
	if (entries.length >= MAX_ENTRIES) entries.shift();
	entries.push({ method, args });
}

function onError(event) {
	record("error", [event.error ?? event.message]);
}

function onRejection(event) {
	record("error", ["Unhandled rejection:", event.reason]);
}

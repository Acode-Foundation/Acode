/**
 * TEMPORARY startup instrumentation for comparing launch times.
 * Remove this file and every `startupPerf` call once measurements are done.
 *
 * Read the result with:
 *   adb logcat | grep startup-perf
 * or from devtools: window.__startupPerf
 */

const PREFIX = "startup:";

/**
 * Record a startup milestone (milliseconds since the WebView started loading).
 * @param {string} name
 */
function mark(name) {
	try {
		performance.mark(PREFIX + name);
	} catch {
		// performance API unavailable; measurements are best effort
	}
}

/**
 * Log every milestone with its time and the gap from the previous one.
 */
function report() {
	let marks = [];
	try {
		marks = performance
			.getEntriesByType("mark")
			.filter((entry) => entry.name.startsWith(PREFIX))
			.sort((a, b) => a.startTime - b.startTime);
	} catch {
		return;
	}

	let previous = 0;
	const rows = marks.map((entry) => {
		const at = Math.round(entry.startTime);
		const row = {
			step: entry.name.slice(PREFIX.length),
			at,
			delta: at - previous,
		};
		previous = at;
		return row;
	});

	window.__startupPerf = rows;
	const lines = rows.map(
		({ step, at, delta }) =>
			`${String(at).padStart(6)}ms (+${String(delta).padStart(5)}ms) ${step}`,
	);
	const text = `[startup-perf]\n${lines.join("\n")}`;
	console.info(text);
	window.log?.("info", text);
}

export default { mark, report };

const MAX_MESSAGES_PER_SECOND = 100;
const MESSAGE_WINDOW_MS = 1000;
const MAX_PROPERTIES = 100;
const MAX_DEPTH = 4;
const MAX_SNAPSHOT_VALUES = 500;

let activeCommandId = 0;
let messageWindowStartedAt = 0;
let emittedInWindow = 0;
let suppressedInWindow = 0;
const counts = new Map();
const timers = new Map();

function snapshot(
	value,
	depth = 0,
	seen = new WeakSet(),
	budget = { remaining: MAX_SNAPSHOT_VALUES },
) {
	const type = typeof value;

	if (
		value === null ||
		["boolean", "number", "string", "undefined"].includes(type)
	) {
		return value;
	}
	if (type === "bigint") return `${value}n`;
	if (type === "symbol") return value.toString();
	if (type === "function")
		return `[Function${value.name ? `: ${value.name}` : ""}]`;
	if (budget.remaining-- <= 0) return "[Truncated]";
	if (value instanceof Error) return snapshotError(value);
	if (value instanceof Date) return value.toISOString();
	if (value instanceof RegExp) return value.toString();
	if (value instanceof Promise) return "Promise { <pending> }";
	if (depth >= MAX_DEPTH) return `[${value.constructor?.name || "Object"}]`;
	if (seen.has(value)) return "[Circular]";

	seen.add(value);
	if (Array.isArray(value)) {
		const result = value
			.slice(0, MAX_PROPERTIES)
			.map((item) => snapshot(item, depth + 1, seen, budget));
		if (value.length > MAX_PROPERTIES) result.push("…");
		return result;
	}

	const result = {};
	let keys;
	try {
		keys = Reflect.ownKeys(value).slice(0, MAX_PROPERTIES);
	} catch (error) {
		return `[Uninspectable: ${error.message}]`;
	}

	for (const key of keys) {
		const outputKey = typeof key === "symbol" ? key.toString() : key;
		try {
			result[outputKey] = snapshot(value[key], depth + 1, seen, budget);
		} catch (error) {
			result[outputKey] = `[Thrown: ${error.message}]`;
		}
	}
	if (Reflect.ownKeys(value).length > MAX_PROPERTIES) result["…"] = "…";
	return result;
}

function snapshotError(error) {
	return {
		name: error?.name || "Error",
		message: error?.message || String(error),
		stack: error?.stack || "",
	};
}

function discardSuppressedMessages() {
	suppressedInWindow = 0;
}

function emitMessage(message) {
	const now = performance.now();
	if (now - messageWindowStartedAt >= MESSAGE_WINDOW_MS) {
		discardSuppressedMessages();
		messageWindowStartedAt = now;
		emittedInWindow = 0;
	}

	if (emittedInWindow >= MAX_MESSAGES_PER_SECOND) {
		suppressedInWindow++;
		return;
	}

	emittedInWindow++;
	self.postMessage({ type: "console", id: activeCommandId, ...message });
}

function emit(level, args) {
	emitMessage({
		level,
		args: args.map((value) => snapshot(value)),
	});
}

self.console = {
	assert(condition, ...args) {
		if (!condition) emit("error", args.length ? args : ["Assertion failed"]);
	},
	clear() {
		emitMessage({ action: "clear" });
	},
	count(label = "default") {
		const value = (counts.get(label) || 0) + 1;
		counts.set(label, value);
		emit("log", [`${label}: ${value}`]);
	},
	countReset(label = "default") {
		counts.delete(label);
	},
	debug: (...args) => emit("log", args),
	dir: (...args) => emit("log", args),
	dirxml: (...args) => emit("log", args),
	error: (...args) => emit("error", args),
	group: (...args) => emit("log", args),
	groupCollapsed: (...args) => emit("log", args),
	groupEnd() {},
	info: (...args) => emit("info", args),
	log: (...args) => emit("log", args),
	table: (...args) => emit("table", args),
	time(label = "default") {
		timers.set(label, performance.now());
	},
	timeEnd(label = "default") {
		if (!timers.has(label)) return emit("warn", [`No such label: ${label}`]);
		emit("log", [
			`${label}: ${(performance.now() - timers.get(label)).toFixed(2)}ms`,
		]);
		timers.delete(label);
	},
	timeLog(label = "default") {
		if (!timers.has(label)) return emit("warn", [`No such label: ${label}`]);
		emit("log", [
			`${label}: ${(performance.now() - timers.get(label)).toFixed(2)}ms`,
		]);
	},
	trace(...args) {
		emit("trace", [...args, new Error().stack]);
	},
	warn: (...args) => emit("warn", args),
};

self.onmessage = ({ data: { id, code } }) => {
	activeCommandId = id;
	messageWindowStartedAt = performance.now();
	emittedInWindow = 0;
	suppressedInWindow = 0;

	try {
		// Intentional: this local REPL runs the command in its isolated worker.
		// codeql[js/code-injection]
		const value = (0, eval)(code);
		discardSuppressedMessages();
		self.postMessage({ type: "result", id, value: snapshot(value) });
	} catch (error) {
		discardSuppressedMessages();
		self.postMessage({ type: "error", id, error: snapshotError(error) });
	}
};

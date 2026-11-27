import { expect, it, vi } from "vitest";
import { loadSourceModule } from "../helpers/loadSourceModule";

function setup() {
	const original = {
		log: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	};
	const fakeConsole = { ...original };
	const window = new EventTarget();
	const buffer = loadSourceModule(
		"src/lib/startupLogBuffer.js",
		{},
		{ console: fakeConsole, window },
	);
	return { buffer, original, fakeConsole, window };
}

it("records console calls and uncaught errors while still printing them", () => {
	const { buffer, original, fakeConsole, window } = setup();
	fakeConsole.log("a", 1);
	fakeConsole.warn("careful");
	const error = new Error("boom");
	window.dispatchEvent(Object.assign(new Event("error"), { error }));
	const rejection = new Event("unhandledrejection");
	rejection.reason = "nope";
	window.dispatchEvent(rejection);

	expect(original.log).toHaveBeenCalledWith("a", 1);
	expect(buffer.takeStartupLogs()).toEqual([
		{ method: "log", args: ["a", 1] },
		{ method: "warn", args: ["careful"] },
		{ method: "error", args: [error] },
		{ method: "error", args: ["Unhandled rejection:", "nope"] },
	]);
});

it("restores console and stops recording once taken or discarded", () => {
	const { buffer, original, fakeConsole } = setup();
	buffer.discardStartupLogs();
	expect(fakeConsole.log).toBe(original.log);
	fakeConsole.log("later");
	expect(buffer.takeStartupLogs()).toEqual([]);
});

it("leaves a later console wrapper in place and becomes a pass-through", () => {
	const { buffer, original, fakeConsole } = setup();
	const ours = fakeConsole.log;
	const later = (...args) => ours(...args);
	fakeConsole.log = later;
	buffer.takeStartupLogs();

	expect(fakeConsole.log).toBe(later);
	fakeConsole.log("still printed");
	expect(original.log).toHaveBeenCalledWith("still printed");
	expect(buffer.takeStartupLogs()).toEqual([]);
});

it("keeps only the most recent 1000 entries", () => {
	const { buffer, fakeConsole } = setup();
	for (let i = 0; i < 1005; i++) fakeConsole.log(i);
	const logs = buffer.takeStartupLogs();
	expect(logs).toHaveLength(1000);
	expect(logs[0].args).toEqual([5]);
});

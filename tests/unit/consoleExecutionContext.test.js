import { describe, expect, it } from "vitest";
import {
	executeConsoleCommand,
	executeConsoleScript,
	resolveConsoleExecutionContext,
} from "lib/consoleRuntime";

describe("console execution context", () => {
	it("forces standalone menu consoles to use the worker", () => {
		expect(resolveConsoleExecutionContext(true, "page")).toBe("worker");
		expect(resolveConsoleExecutionContext(false, "page")).toBe("page");
	});

	it("uses isolated worker execution by default", async () => {
		const calls = [];
		const result = await executeConsoleCommand({
			context: "worker",
			code: "document.title",
			workerExecutor: {
				execute(code) {
					calls.push(["worker", code]);
					return Promise.resolve({ type: "result", value: "isolated" });
				},
			},
			pageExecutor(code) {
				calls.push(["page", code]);
			},
		});

		expect(calls).toEqual([["worker", "document.title"]]);
		expect(result.value).toBe("isolated");
	});

	it("restores live page execution when explicitly selected", async () => {
		const calls = [];
		const result = await executeConsoleCommand({
			context: "page",
			code: 'document.querySelector("main")',
			workerExecutor: {
				execute(code) {
					calls.push(["worker", code]);
				},
			},
			pageExecutor(code) {
				calls.push(["page", code]);
				return { type: "result", value: "live page" };
			},
		});

		expect(calls).toEqual([["page", 'document.querySelector("main")']]);
		expect(result.value).toBe("live page");
	});

	it("loads Run-button scripts and executes them in the worker", async () => {
		const calls = [];
		const result = await executeConsoleScript({
			scriptUrl: "example.js",
			fetchScript: async (url, options) => {
				calls.push(["fetch", url, options]);
				return {
					ok: true,
					text: async () => "while (true) {}",
				};
			},
			workerExecutor: {
				execute(code) {
					calls.push(["worker", code]);
					return Promise.resolve({ type: "result" });
				},
			},
		});

		expect(calls).toEqual([
			["fetch", "example.js", { cache: "no-store" }],
			["worker", "while (true) {}"],
		]);
		expect(result).toEqual({ type: "result" });
	});

	it("does not load a script for an empty menu console", async () => {
		let fetched = false;
		const result = await executeConsoleScript({
			scriptUrl: null,
			fetchScript: async () => {
				fetched = true;
			},
		});

		expect(fetched).toBe(false);
		expect(result).toBeNull();
	});

	it("returns a console error when a Run-button script cannot be loaded", async () => {
		let executed = false;
		const result = await executeConsoleScript({
			scriptUrl: "missing.js",
			fetchScript: async () => ({ ok: false, status: 404 }),
			workerExecutor: {
				execute() {
					executed = true;
				},
			},
		});

		expect(executed).toBe(false);
		expect(result).toMatchObject({
			type: "error",
			value: { message: "Failed to load JavaScript file (404)." },
		});
	});
});

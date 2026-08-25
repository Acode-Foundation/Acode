import { describe, expect, it } from "vitest";
import {
	executeConsoleCommand,
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
});

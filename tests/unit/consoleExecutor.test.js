import { beforeEach, describe, expect, it, vi } from "vitest";
import ConsoleExecutor from "lib/consoleRuntime";

class FakeWorker {
	static instances = [];

	constructor(url) {
		this.url = url;
		this.terminate = vi.fn();
		this.postMessage = vi.fn();
		FakeWorker.instances.push(this);
	}

	respond(data) {
		this.onmessage({ data });
	}
}

describe("ConsoleExecutor", () => {
	beforeEach(() => {
		FakeWorker.instances = [];
		vi.useRealTimers();
	});

	it("returns a worker result and reuses the isolated context", async () => {
		const executor = new ConsoleExecutor({
			workerUrl: "/console-worker.js",
			WorkerClass: FakeWorker,
		});

		const firstResult = executor.execute("1 + 1");
		const worker = FakeWorker.instances[0];
		expect(worker.url).toBe("/console-worker.js");
		expect(worker.postMessage).toHaveBeenCalledWith({ id: 1, code: "1 + 1" });

		worker.respond({ type: "result", id: 1, value: 2 });
		await expect(firstResult).resolves.toEqual({ type: "result", value: 2 });

		const secondResult = executor.execute("3 + 4");
		expect(FakeWorker.instances).toHaveLength(1);
		worker.respond({ type: "result", id: 2, value: 7 });
		await expect(secondResult).resolves.toEqual({ type: "result", value: 7 });
	});

	it("forwards console messages from the worker", async () => {
		const onConsole = vi.fn();
		const executor = new ConsoleExecutor({
			workerUrl: "/console-worker.js",
			WorkerClass: FakeWorker,
			onConsole,
		});

		const result = executor.execute("console.log('hello')");
		const worker = FakeWorker.instances[0];
		const message = {
			type: "console",
			id: 1,
			level: "log",
			args: ["hello"],
		};
		worker.respond(message);
		worker.respond({ type: "result", id: 1 });

		expect(onConsole).toHaveBeenCalledWith(message);
		await expect(result).resolves.toEqual({ type: "result", value: undefined });
	});

	it("terminates and replaces a worker when execution times out", async () => {
		vi.useFakeTimers();
		const executor = new ConsoleExecutor({
			workerUrl: "/console-worker.js",
			WorkerClass: FakeWorker,
			timeout: 50,
		});

		const timedOutResult = executor.execute("while (true) {}");
		const blockedWorker = FakeWorker.instances[0];
		await vi.advanceTimersByTimeAsync(50);

		const result = await timedOutResult;
		expect(result.type).toBe("error");
		expect(result.value.message).toBe("Execution stopped after 0.05 seconds.");
		expect(blockedWorker.terminate).toHaveBeenCalledOnce();

		const nextResult = executor.execute("42");
		expect(FakeWorker.instances).toHaveLength(2);
		FakeWorker.instances[1].respond({ type: "result", id: 2, value: 42 });
		await expect(nextResult).resolves.toEqual({ type: "result", value: 42 });
	});

	it("allows a running command to be stopped immediately", async () => {
		const executor = new ConsoleExecutor({
			workerUrl: "/console-worker.js",
			WorkerClass: FakeWorker,
		});

		const stoppedResult = executor.execute("while (true) {}");
		const blockedWorker = FakeWorker.instances[0];

		expect(executor.cancel()).toBe(true);
		await expect(stoppedResult).resolves.toMatchObject({
			type: "error",
			value: { message: "Execution stopped." },
		});
		expect(blockedWorker.terminate).toHaveBeenCalledOnce();
		expect(executor.cancel()).toBe(false);
	});

	it("turns worker errors into console errors", async () => {
		const executor = new ConsoleExecutor({
			workerUrl: "/console-worker.js",
			WorkerClass: FakeWorker,
		});

		const result = executor.execute("missingName");
		FakeWorker.instances[0].respond({
			type: "error",
			id: 1,
			error: {
				name: "ReferenceError",
				message: "missingName is not defined",
				stack: "worker stack",
			},
		});

		const errorResult = await result;
		expect(errorResult.type).toBe("error");
		expect(errorResult.value).toMatchObject({
			name: "ReferenceError",
			message: "missingName is not defined",
			stack: "worker stack",
		});
	});
});

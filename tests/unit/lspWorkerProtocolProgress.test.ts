import { describe, expect, it } from "vitest";

interface JsonMessage {
	id?: string | number;
	method?: string;
	params?: { token?: string; value?: { kind?: string; title?: string } };
}

describe("LSP worker progress over the protocol", () => {
	it("creates a token only after initialized, then reports begin and end", async () => {
		const posted: unknown[] = [];
		const scope = globalThis as unknown as Record<string, unknown>;
		scope.postMessage = (message: unknown) => posted.push(message);
		scope.close = () => {};
		const { METHOD_NOT_HANDLED, startWorkerServer } = await import(
			"../../src/cm/lsp/workers/protocol"
		);
		startWorkerServer((context) => {
			context.progress("Loading app", "Reading configuration").end();
			return { capabilities: {}, request: () => METHOD_NOT_HANDLED };
		});
		const deliver = (data: unknown) =>
			(scope.onmessage as (event: { data: unknown }) => void)({ data });
		const json = () =>
			posted
				.filter((message): message is string => typeof message === "string")
				.map((message) => JSON.parse(message) as JsonMessage);

		deliver({ kind: "configure", serverId: "typescript" });
		await flush();
		deliver(
			JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "initialize",
				params: { capabilities: { window: { workDoneProgress: true } } },
			}),
		);
		await flush();
		expect(json().some((message) => message.method)).toBe(false);

		deliver(JSON.stringify({ jsonrpc: "2.0", method: "initialized" }));
		await flush();
		const create = json().find(
			(message) => message.method === "window/workDoneProgress/create",
		);
		expect(create?.id).toBeDefined();
		const token = create?.params?.token;

		deliver(JSON.stringify({ jsonrpc: "2.0", id: create?.id, result: null }));
		await flush();
		const progress = json().filter(
			(message) => message.method === "$/progress",
		);
		expect(progress.map((message) => message.params?.token)).toEqual([
			token,
			token,
		]);
		expect(progress.map((message) => message.params?.value?.kind)).toEqual([
			"begin",
			"end",
		]);
		expect(progress[0].params?.value?.title).toBe("Loading app");
	});
});

describe("LSP worker transport", () => {
	it("acknowledges progress tokens and forwards everything else", async () => {
		class FakeWorker {
			static last: FakeWorker;
			posted: unknown[] = [];
			onmessage: ((event: { data: unknown }) => void) | null = null;
			onerror: unknown = null;
			constructor() {
				FakeWorker.last = this;
			}
			postMessage(message: unknown) {
				this.posted.push(message);
			}
			terminate() {}
		}
		(globalThis as unknown as Record<string, unknown>).Worker = FakeWorker;
		const { createWorkerTransport } = await import(
			"../../src/cm/lsp/workerTransport"
		);
		const { transport } = createWorkerTransport({
			url: "worker.js",
			serverId: "typescript",
		});
		const received: string[] = [];
		transport.subscribe((message) => received.push(message));
		const worker = FakeWorker.last;

		worker.onmessage?.({
			data: JSON.stringify({
				jsonrpc: "2.0",
				id: "worker-1",
				method: "window/workDoneProgress/create",
				params: { token: "t" },
			}),
		});
		const progress = JSON.stringify({
			jsonrpc: "2.0",
			method: "$/progress",
			params: { token: "t", value: { kind: "begin", title: "Loading" } },
		});
		worker.onmessage?.({ data: progress });

		expect(worker.posted.map((message) => JSON.parse(String(message)))).toEqual(
			[{ jsonrpc: "2.0", id: "worker-1", result: null }],
		);
		expect(received).toEqual([progress]);
	});
});

function flush() {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

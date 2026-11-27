import { describe, expect, it } from "vitest";
import createProgress from "../../src/cm/lsp/workers/progress";

describe("LSP worker work-done progress", () => {
	it("creates a token, then sends begin, reports and end in order", async () => {
		const { channel, sent } = fakeChannel(true);
		const progress = createProgress(channel, "Loading app", "Reading");
		progress.report("Scanned 3 folders");
		progress.end();
		progress.report("ignored after end");
		await flush();

		expect(sent).toEqual([
			"request window/workDoneProgress/create",
			"begin Loading app Reading",
			"report Scanned 3 folders",
			"end",
		]);
	});

	it("stays silent when the client lacks progress support", async () => {
		const { channel, sent } = fakeChannel(false);
		createProgress(channel, "Loading app").end();
		await flush();

		expect(sent).toEqual([]);
	});

	it("does not use a token the client refused", async () => {
		const { channel, sent } = fakeChannel(true, true);
		createProgress(channel, "Loading app").end();
		await flush();

		expect(sent).toEqual(["request window/workDoneProgress/create"]);
	});
});

function fakeChannel(supported: boolean, refuse = false) {
	const sent: string[] = [];
	const channel = {
		ready: Promise.resolve(supported),
		request: async (method: string) => {
			sent.push(`request ${method}`);
			if (refuse) throw new Error("MethodNotFound");
			return null;
		},
		notify: (_method: string, params: unknown) => {
			const { value } = params as {
				value: { kind: string; title?: string; message?: string };
			};
			sent.push(
				[value.kind, value.title, value.message].filter(Boolean).join(" "),
			);
		},
	};
	return { channel, sent };
}

function flush() {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
	vi.resetModules();
	vi.unstubAllGlobals();
});

describe("plugin context native bridge", () => {
	it("uses and hardens the initialized native bridge", async () => {
		const nativeExec = vi.fn((resolve, _reject, _service, action) => {
			if (action === "establishConnection") {
				resolve("trusted-session");
			} else if (action === "requestToken") {
				resolve("plugin-token");
			}
		});
		vi.stubGlobal("Bridge", { exec: nativeExec });

		const pluginContext = await import("lib/pluginContext");

		await expect(pluginContext.connect()).resolves.toBe(true);
		expect(Object.getOwnPropertyDescriptor(Bridge, "exec").writable).toBe(
			false,
		);
		expect(Object.getOwnPropertyDescriptor(Bridge, "exec").configurable).toBe(
			false,
		);
		await expect(
			pluginContext.default("example.plugin", "{}"),
		).resolves.toBeTruthy();
	});
});

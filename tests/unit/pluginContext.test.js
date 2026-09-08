import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
	vi.resetModules();
	vi.unstubAllGlobals();
});

describe("plugin context Cordova bridge", () => {
	it("loads before cordova.exec is mapped", async () => {
		const nativeExec = vi.fn((resolve, _reject, _service, action) => {
			if (action === "establishConnection") {
				resolve("trusted-session");
			} else if (action === "requestToken") {
				resolve("plugin-token");
			}
		});
		const requireModule = vi.fn(() => nativeExec);
		vi.stubGlobal("cordova", { require: requireModule });

		const pluginContext = await import("lib/pluginContext");

		expect(requireModule).toHaveBeenCalledWith("cordova/exec");
		expect(cordova.exec).toBeUndefined();
		await expect(pluginContext.connect()).resolves.toBe(true);
		await expect(pluginContext.default("example.plugin", "{}")).resolves.toBeTruthy();
	});
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const { nativeBridge } = vi.hoisted(() => ({
	nativeBridge: {
		setMessageCallback: vi.fn(),
		create: vi.fn(),
		evaluate: vi.fn(),
		destroy: vi.fn(),
	},
}));

vi.mock("../../src/plugins/webview/www/webview", () => ({
	default: nativeBridge,
}));

import webviewAPI from "lib/webview";

describe("WebView lifecycle", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		nativeBridge.create.mockResolvedValue("webview-1");
		nativeBridge.evaluate.mockResolvedValue("result");
		nativeBridge.destroy.mockResolvedValue(undefined);
	});

	it("keeps the instance usable when native destruction fails", async () => {
		const webview = await webviewAPI.create();
		nativeBridge.destroy.mockRejectedValueOnce(new Error("native failure"));

		await expect(webview.destroy()).rejects.toThrow("native failure");
		await expect(webview.evaluate("1 + 1")).resolves.toBe("result");
		expect(nativeBridge.evaluate).toHaveBeenCalledWith("webview-1", "1 + 1");

		await expect(webview.destroy()).resolves.toBeUndefined();
		expect(nativeBridge.destroy).toHaveBeenCalledTimes(2);
	});

	it("marks the instance destroyed only after native destruction succeeds", async () => {
		const webview = await webviewAPI.create();

		await webview.destroy();

		await expect(webview.evaluate("1 + 1")).rejects.toThrow(
			"WebView has been destroyed",
		);
	});
});

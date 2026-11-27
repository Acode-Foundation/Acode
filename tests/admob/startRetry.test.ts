import { afterEach, expect, test, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());

test("initialization deduplicates calls and can retry after consent becomes available", async () => {
	vi.stubGlobal("document", {
		createElement: () => ({ getContext: () => null }),
	});
	let complete: ((value: unknown) => void) | undefined;
	let fail: ((error: unknown) => void) | undefined;
	const exec = vi.fn((success, error) => {
		complete = success;
		fail = error;
	});
	vi.stubGlobal("Bridge", { exec });
	const { AdMob } = await import("../../src/native/admob");
	const api = new AdMob();
	const first = api.start();
	expect(api.start()).toBe(first);
	fail?.("Gather ad consent before requesting ads");
	await expect(first).rejects.toContain("consent");
	const retry = api.start();
	expect(exec).toHaveBeenCalledTimes(2);
	complete?.({ version: "test" });
	await expect(retry).resolves.toEqual({ version: "test" });
	expect(api.start()).toBe(retry);
});

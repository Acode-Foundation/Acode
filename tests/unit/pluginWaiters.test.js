import { describe, expect, it } from "vitest";
import PluginWaiters from "../../src/lib/pluginWaiters";

describe("PluginWaiters", () => {
	it("resolves every caller waiting for the same plugin with true by default", async () => {
		const waiters = new PluginWaiters();
		const first = waiters.waitFor("example");
		const second = waiters.waitFor("example");

		waiters.resolve("example");

		await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
	});

	it("resolves caller with a custom value when provided", async () => {
		const waiters = new PluginWaiters();
		const first = waiters.waitFor("custom");

		waiters.resolve("custom", { pluginId: "custom" });

		await expect(first).resolves.toEqual({ pluginId: "custom" });
	});

	it("rejects every pending caller with its plugin-specific error", async () => {
		const waiters = new PluginWaiters();
		const first = waiters.waitFor("first");
		const second = waiters.waitFor("first");
		const third = waiters.waitFor("second");
		const pending = Promise.allSettled([first, second, third]);

		waiters.rejectAll(
			(pluginId) => new Error(`Plugin '${pluginId}' failed to load.`),
		);

		expect(await pending).toEqual([
			{
				status: "rejected",
				reason: new Error("Plugin 'first' failed to load."),
			},
			{
				status: "rejected",
				reason: new Error("Plugin 'first' failed to load."),
			},
			{
				status: "rejected",
				reason: new Error("Plugin 'second' failed to load."),
			},
		]);
	});

	it("skips filtered plugins during rejectAll", async () => {
		const waiters = new PluginWaiters();
		const inflight = waiters.waitFor("inflight");
		const failed = waiters.waitFor("failed");

		waiters.rejectAll(
			(pluginId) => new Error(`Plugin '${pluginId}' failed to load.`),
			(pluginId) => pluginId !== "inflight",
		);

		waiters.resolve("inflight", true);

		await expect(inflight).resolves.toBe(true);
		await expect(failed).rejects.toThrow("Plugin 'failed' failed to load.");
	});

	it("rejects an individual plugin via reject()", async () => {
		const waiters = new PluginWaiters();
		const pending = waiters.waitFor("broken");

		waiters.reject("broken", new Error("Syntax error"));

		await expect(pending).rejects.toThrow("Syntax error");
	});
});

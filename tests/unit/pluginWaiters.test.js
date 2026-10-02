import { expect, it } from "vitest";
import PluginWaiters from "../../src/lib/pluginWaiters";

it("resolves every caller waiting for the same plugin", async () => {
	const waiters = new PluginWaiters();
	const first = waiters.waitFor("example");
	const second = waiters.waitFor("example");

	waiters.resolve("example");

	await expect(Promise.all([first, second])).resolves.toEqual([
		undefined,
		undefined,
	]);
});

it("rejects every pending caller with its plugin-specific error", async () => {
	const waiters = new PluginWaiters();
	const first = waiters.waitFor("first");
	const second = waiters.waitFor("first");
	const third = waiters.waitFor("second");
	const pending = Promise.allSettled([first, second, third]);

	waiters.rejectAll((pluginId) => new Error(`Plugin '${pluginId}' failed to load.`));

	expect(await pending).toEqual([
		{ status: "rejected", reason: new Error("Plugin 'first' failed to load.") },
		{ status: "rejected", reason: new Error("Plugin 'first' failed to load.") },
		{ status: "rejected", reason: new Error("Plugin 'second' failed to load.") },
	]);
});

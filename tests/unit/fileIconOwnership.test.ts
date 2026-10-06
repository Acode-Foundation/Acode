// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import fileIcons from "lib/fileIcons";

afterEach(() => fileIcons.resetForTests());

it("binds registration to the loading plugin and rejects mismatched ownership", () => {
	const script = document.createElement("script");
	const api = fileIcons.bindPlugin(script, "owner.plugin");
	expect(fileIcons.getPluginApi(script)).toBe(api);
	const pack = { id: "owner.icons", icons: "file:///icons/", file: "default" };
	expect(() => api.register({ ...pack, pluginId: "typo.plugin" })).toThrow(
		/loading plugin 'owner.plugin'/,
	);
	expect(fileIcons.list().some((pack) => pack.id === "owner.icons")).toBe(
		false,
	);
	api.register(pack);
	expect(
		fileIcons.list().find((pack) => pack.id === "owner.icons")?.pluginId,
	).toBe("owner.plugin");
	fileIcons.use("owner.icons", { persist: false });
	expect(
		document.querySelector('style[data-file-icon="owner.icons"]'),
	).not.toBeNull();
	fileIcons.unregisterByPlugin("owner.plugin");
	expect(fileIcons.active().id).toBe("builtin");
	expect(
		document.querySelector('style[data-file-icon="owner.icons"]'),
	).toBeNull();
	expect(() => api.register(pack)).toThrow(/unloaded/);
});

it("keeps interleaved asynchronous plugin registrations scoped across reloads", async () => {
	const first = fileIcons.bindPlugin(document.createElement("script"), "first");
	const second = fileIcons.bindPlugin(
		document.createElement("script"),
		"second",
	);
	await Promise.resolve();
	second.register({ id: "second.icons" });
	first.register({ id: "first.icons", pluginId: "first" });
	fileIcons.unregisterByPlugin("first");
	const replacement = fileIcons.bindPlugin(
		document.createElement("script"),
		"first",
	);
	replacement.register({ id: "first.icons" });
	expect(() => first.register({ id: "first.icons" })).toThrow(/unloaded/);
	expect(
		fileIcons
			.list()
			.filter((pack) => pack.available)
			.map((pack) => pack.id),
	).toEqual(["builtin", "second.icons", "first.icons"]);
});

it("does not offer an unscoped registration API outside plugin execution", () => {
	expect(() => fileIcons.getPluginApi(null)).toThrow(/options.fileIcons/);
	expect(() =>
		fileIcons.getPluginApi(document.createElement("script")),
	).toThrow(/plugin main script/);
});

it("removes plugin listeners before pack teardown emits a change", () => {
	const api = fileIcons.bindPlugin(document.createElement("script"), "owner");
	api.register({ id: "owner.icons" });
	fileIcons.use("owner.icons", { persist: false });
	const listener = vi.fn();
	api.onChange(listener);
	const internal = vi.fn();
	const offInternal = fileIcons.onChange(internal);
	fileIcons.unregisterByPlugin("owner");
	expect(internal).toHaveBeenCalledTimes(1);
	expect(listener).not.toHaveBeenCalled();
	fileIcons.use("missing", { persist: false });
	expect(listener).not.toHaveBeenCalled();
	expect(() => api.onChange(listener)).toThrow(/unloaded/);
	offInternal();
});

it("cleans listener-only scopes on failed init and isolates reloaded subscriptions", () => {
	const listener = vi.fn();
	const old = fileIcons.bindPlugin(document.createElement("script"), "owner");
	const staleUnsubscribe = old.onChange(listener);
	// The loader uses this same teardown path when initialization fails.
	fileIcons.unregisterByPlugin("owner");
	const current = fileIcons.bindPlugin(
		document.createElement("script"),
		"owner",
	);
	const off = current.onChange(listener);
	staleUnsubscribe();
	staleUnsubscribe();
	fileIcons.use("missing", { persist: false });
	expect(listener).toHaveBeenCalledTimes(1);
	off();
	off();
	fileIcons.use("builtin", { persist: false });
	expect(listener).toHaveBeenCalledTimes(1);
});

it("preserves another plugin's subscription to the same callback", () => {
	const listener = vi.fn();
	const first = fileIcons.bindPlugin(document.createElement("script"), "first");
	const second = fileIcons.bindPlugin(
		document.createElement("script"),
		"second",
	);
	first.onChange(listener);
	second.onChange(listener);
	fileIcons.unregisterByPlugin("first");
	fileIcons.use("missing", { persist: false });
	expect(listener).toHaveBeenCalledTimes(1);
	fileIcons.unregisterByPlugin("second");
	fileIcons.use("builtin", { persist: false });
	expect(listener).toHaveBeenCalledTimes(1);
});

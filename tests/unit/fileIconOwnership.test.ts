// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";
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

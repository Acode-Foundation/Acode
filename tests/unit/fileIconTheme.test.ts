import { afterEach, describe, expect, it } from "vitest";
import fileIcons, { BUILTIN_THEME_ID } from "lib/fileIcons";

afterEach(() => {
	fileIcons.resetForTests();
});

function classOf(resource: Parameters<typeof fileIcons.icon>[0]) {
	return fileIcons.icon(resource);
}

describe("built-in file icon matching", () => {
	it("prefers exact filenames over extensions", () => {
		const handle = fileIcons.resolve("package.json");
		expect(handle.source).toBe("fileName");
		expect(handle.iconId).toBe("npm");
		expect(handle.className).toContain("file_type_npm");
	});

	it("matches gitignore as a filename, not an extension", () => {
		const handle = fileIcons.resolve(".gitignore");
		expect(handle.source).toBe("fileName");
		expect(handle.iconId).toBe("git");
		expect(handle.className).toContain("file_type_git");
	});

	it("uses the longest compound extension", () => {
		expect(fileIcons.resolve("button.test.ts").iconId).toBe("testts");
		expect(fileIcons.resolve("index.d.ts").iconId).toBe("typescriptdef");
		expect(fileIcons.resolve("bundle.js.map").iconId).toBe("jsmap");
		expect(fileIcons.resolve("app.ts").iconId).toBe("ts");
	});

	it("matches extensions case-insensitively", () => {
		expect(fileIcons.resolve("Photo.PNG").iconId).toBe("image");
		expect(fileIcons.resolve("ARCHIVE.TAR.GZ").iconId).toBe("compressed");
	});

	it("keeps file-type classes compatible with the existing icon font", () => {
		expect(classOf("package.json")).toContain("file_type_npm");
		expect(classOf("webpack.config.js")).toContain("file_type_webpack");
		expect(classOf("notes.txt")).toContain("file_type_txt");
	});
});

describe("built-in folder icons", () => {
	it("uses the same expandable folder glyph for every folder", () => {
		expect(classOf({ kind: "folder", name: "src" })).toBe("icon folder");
		expect(classOf({ kind: "folder", name: "node_modules" })).toBe(
			"icon folder",
		);
		expect(classOf({ kind: "folder", name: "random-dir" })).toBe("icon folder");
	});
});

describe("plugin icon themes", () => {
	it("keeps the built-in theme active until a preferred plugin theme registers", () => {
		fileIcons.use("material-icons", { persist: false });
		expect(fileIcons.active()).toMatchObject({
			id: BUILTIN_THEME_ID,
			preferredId: "material-icons",
			available: false,
		});
		expect(fileIcons.resolve("app.js").themeId).toBe(BUILTIN_THEME_ID);

		fileIcons.register({
			id: "material-icons",
			name: "Material Icons",
			pluginId: "acode.material.icons",
			icons: {
				js: { className: "icon material-js" },
			},
			fileExtensions: { js: "js" },
			file: "js",
			folder: "js",
		});

		expect(fileIcons.active().id).toBe("material-icons");
		expect(fileIcons.resolve("app.js")).toMatchObject({
			className: "icon material-js",
			iconId: "js",
			source: "fileExtension",
			themeId: "material-icons",
		});
	});

	it("does not apply inactive plugin themes", () => {
		fileIcons.register({
			pluginId: "test.plugin",
			id: "other-icons",
			name: "Other",
			icons: {
				js: { className: "icon other-js" },
			},
			fileExtensions: { js: "js" },
		});

		expect(fileIcons.active().id).toBe(BUILTIN_THEME_ID);
		expect(fileIcons.icon("app.js")).not.toContain("other-js");
	});

	it("resolves SVG packs from an icons folder like VS Code iconPath", () => {
		fileIcons.register({
			pluginId: "test.plugin",
			id: "pack",
			name: "Pack",
			icons: "https://example.com/icons/",
			fileExtensions: { js: "javascript" },
			folderNames: { src: "folder-src" },
			folder: "folder",
			folderExpanded: "folder-open",
		});
		fileIcons.use("pack", { persist: false });

		expect(fileIcons.resolve("app.js").iconId).toBe("javascript");
		expect(fileIcons.resolve({ kind: "folder", name: "src" }).iconId).toBe(
			"folder-src",
		);
		expect(
			fileIcons.resolve({ kind: "folder", name: "other", expanded: true })
				.iconId,
		).toBe("folder-open");
	});

	it("falls back to the built-in theme when the active plugin unregisters", () => {
		const registration = fileIcons.register({
			id: "temp-icons",
			name: "Temp",
			pluginId: "plugin.temp",
			icons: {
				file: { className: "icon temp-file" },
			},
			file: "file",
		});
		fileIcons.use("temp-icons", { persist: false });
		expect(fileIcons.icon("unknown.xyz")).toBe("icon temp-file");

		registration.dispose();
		expect(fileIcons.active().id).toBe(BUILTIN_THEME_ID);
		expect(fileIcons.resolve("unknown.xyz").themeId).toBe(BUILTIN_THEME_ID);
	});

	it("unregisters themes owned by a plugin", () => {
		fileIcons.register({
			id: "owned-icons",
			name: "Owned",
			pluginId: "plugin.owned",
			icons: { file: { className: "icon owned" } },
			file: "file",
		});
		fileIcons.use("owned-icons", { persist: false });
		fileIcons.unregisterByPlugin("plugin.owned");
		expect(
			fileIcons.list().find((theme) => theme.id === "owned-icons")?.available,
		).not.toBe(true);
		expect(fileIcons.active()).toMatchObject({
			id: BUILTIN_THEME_ID,
			preferredId: "owned-icons",
			available: false,
		});
	});

	it("resolves batches in input order", () => {
		const handles = fileIcons.resolveMany([
			"package.json",
			{ kind: "folder", name: "src" },
			"main.py",
		]);
		expect(handles.map((handle) => handle.iconId)).toEqual([
			"npm",
			"folder",
			"py",
		]);
	});

	it("rejects invalid themes without replacing a previous valid version", () => {
		fileIcons.register({
			pluginId: "test.plugin",
			id: "stable-icons",
			name: "Stable",
			icons: { js: { className: "icon stable-js" } },
			fileExtensions: { js: "js" },
		});
		fileIcons.use("stable-icons", { persist: false });

		expect(() =>
			fileIcons.register({
				pluginId: "test.plugin",
				id: "stable-icons",
				fileExtensions: { js: "js" },
				icons: { js: { src: "javascript:alert(1)" } },
			}),
		).toThrow(/Unsafe/);

		expect(fileIcons.icon("app.js")).toBe("icon stable-js");
	});

	it("rejects conflicting normalized associations", () => {
		expect(() =>
			fileIcons.register({
				id: "duplicates",
				pluginId: "test.plugin",
				icons: { a: { className: "a" }, b: { className: "b" } },
				fileExtensions: { js: "a", JS: "b" },
			}),
		).toThrow(/Conflicting fileExtension/);
	});
});

describe("theme contract", () => {
	const theme = (id = "test") => ({
		id,
		pluginId: "test.plugin",
		icons: {
			closed: { className: "custom-closed" },
			open: { className: "custom-open" },
		},
		folder: "closed",
	});

	it("inherits a custom closed folder for expanded and root folders", () => {
		fileIcons.register(theme());
		fileIcons.use("test", { persist: false });
		for (const isRoot of [false, true]) {
			expect(
				fileIcons.icon({
					kind: "folder",
					name: "other",
					expanded: true,
					isRoot,
				}),
			).toBe("custom-closed");
		}
	});

	it("honors explicit expanded and root icons", () => {
		fileIcons.register({
			...theme(),
			folderExpanded: "open",
			rootFolder: "closed",
		});
		fileIcons.use("test", { persist: false });
		expect(
			fileIcons.icon({ kind: "folder", name: "other", expanded: true }),
		).toBe("custom-open");
		expect(
			fileIcons.icon({
				kind: "folder",
				name: "other",
				expanded: true,
				isRoot: true,
			}),
		).toBe("custom-closed");
	});

	it("does not let an obsolete disposal remove its replacement", () => {
		const old = fileIcons.register(theme());
		const current = fileIcons.register({ ...theme(), name: "Replacement" });
		old.dispose();
		expect(fileIcons.list().find((t) => t.id === "test")?.name).toBe(
			"Replacement",
		);
		current.dispose();
		current.dispose();
		expect(fileIcons.list().some((t) => t.id === "test")).toBe(false);
	});

	it("rejects another plugin replacing the same id", () => {
		fileIcons.register(theme());
		expect(() =>
			fileIcons.register({ ...theme(), pluginId: "other.plugin" }),
		).toThrow(/another plugin/);
	});

	it("reports missing references and unsupported fields", () => {
		expect(() =>
			fileIcons.register({ ...theme(), fileExtensions: { js: "missing" } }),
		).toThrow(/fileExtensions.js.*missing/);
		expect(() =>
			fileIcons.register({ ...theme(), label: "Alias" } as never),
		).toThrow(/theme.label/);
		expect(() =>
			fileIcons.register({
				...theme(),
				icons: { bad: { src: "file:///bad.svg", light: "file:///light.svg" } },
			} as never),
		).toThrow(/icons.bad.light/);
	});

	it("requires ownership for automatic cleanup", () => {
		expect(() => fileIcons.register({ id: "missing-owner" } as never)).toThrow(
			/pluginId/,
		);
	});

	it("does not treat a dotfile as an extension", () => {
		fileIcons.register({ ...theme(), fileExtensions: { env: "open" } });
		fileIcons.use("test", { persist: false });
		expect(fileIcons.resolve(".env").source).toBe("default");
		expect(fileIcons.resolve("project.env").iconId).toBe("open");
	});

	it("does not infer undeclared open assets", () => {
		fileIcons.register({
			id: "directory",
			pluginId: "test.plugin",
			icons: "file:///icons/",
			folderNames: { src: "source" },
		});
		fileIcons.use("directory", { persist: false });
		expect(
			fileIcons.resolve({ kind: "folder", name: "src", expanded: true }).iconId,
		).toBe("source");
	});
});

describe("extension scanning edge cases", () => {
	it.each([
		["button.test.ts", "test"],
		["BUTTON.TEST.TS", "test"],
		["button.other.ts", "ts"],
		[".config.test.ts", "test"],
		[".test.ts", "test"],
		["button..ts", "ts"],
		[".ts", "plain"],
		["README", "plain"],
		["button.ts.", "plain"],
		[".", "plain"],
		["..", "plain"],
		["", "plain"],
	])("resolves %j to %s", (name, expected) => {
		fileIcons.register({
			id: "scan",
			pluginId: "test.plugin",
			icons: {
				test: { className: "test" },
				ts: { className: "ts" },
				plain: { className: "plain" },
			},
			fileExtensions: { "test.ts": "test", ts: "ts" },
			file: "plain",
		});
		fileIcons.use("scan", { persist: false });
		expect(fileIcons.icon(name)).toBe(expected);
	});

	it.each([
		["file.UNLISTED", "unlisted"],
		["file..UNLISTED", "unlisted"],
		[".UNLISTED", "default"],
		["file.UNLISTED.", "default"],
		["extensionless", "default"],
	])("keeps the built-in last-extension fallback for %j", (name, expected) => {
		expect(fileIcons.resolve(name).iconId).toBe(expected);
	});
});

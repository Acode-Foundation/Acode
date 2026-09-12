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
			id: "pack",
			name: "Pack",
			icons: "https://example.com/icons/",
			fileExtensions: { js: "javascript" },
			folderNames: { src: "folder-src" },
			folder: "folder",
			folderExpanded: "folder-open",
		});
		fileIcons.use("pack", { persist: false });

		expect(fileIcons.icon("app.js")).toContain("file-icon--pack--javascript");
		expect(fileIcons.icon({ kind: "folder", name: "src" })).toContain(
			"file-icon--pack--folder-src",
		);
		expect(
			fileIcons.icon({ kind: "folder", name: "other", expanded: true }),
		).toContain("file-icon--pack--folder-open");
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

	it("lets user overrides win over theme associations", () => {
		fileIcons.setOverride({
			kind: "file",
			name: "package.json",
			icon: "webpack",
		});
		expect(fileIcons.resolve("package.json").iconId).toBe("webpack");
	});

	it("rejects invalid themes without replacing a previous valid version", () => {
		fileIcons.register({
			id: "stable-icons",
			name: "Stable",
			icons: { js: { className: "icon stable-js" } },
			fileExtensions: { js: "js" },
		});
		fileIcons.use("stable-icons", { persist: false });

		expect(() =>
			fileIcons.update("stable-icons", {
				id: "stable-icons",
				fileExtensions: { js: "js" },
				icons: { js: { src: "javascript:alert(1)" } },
			}),
		).toThrow(/Unsafe/);

		expect(fileIcons.icon("app.js")).toBe("icon stable-js");
	});

	it("lets later associations win when keys collide", () => {
		fileIcons.register({
			id: "dup-icons",
			fileExtensions: { js: "js", JS: "javascript" },
			icons: {
				js: { className: "a" },
				javascript: { className: "b" },
			},
		});
		fileIcons.use("dup-icons", { persist: false });
		expect(fileIcons.resolve("app.js").iconId).toBe("javascript");
	});
});

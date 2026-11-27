import { expect, it } from "vitest";
import { loadSourceModule } from "../helpers/loadSourceModule";

function setup(stored) {
	const storage = new Map(
		stored ? [["pluginHandledExtensions", JSON.stringify(stored)]] : [],
	);
	const { default: registry } = loadSourceModule(
		"src/lib/fileTypeHandler.js",
		{},
		{
			localStorage: {
				getItem: (key) => storage.get(key) ?? null,
				setItem: (key, value) => storage.set(key, value),
			},
		},
	);
	const register = (id, extensions) =>
		registry.registerFileHandler(id, { extensions, handleFile() {} });
	return { registry, storage, register };
}

it("treats every file as possibly plugin-handled until a full load records history", () => {
	const { registry, register } = setup();
	expect(registry.mayHavePluginHandler("book.epub")).toBe(true);
	expect(registry.mayHavePluginHandler("notes.txt")).toBe(true);

	// A fast plugin registering first must not make other types look unhandled.
	register("epub", ["epub"]);
	expect(registry.mayHavePluginHandler("comic.cbz")).toBe(true);

	register("cbz", [".CBZ"]);
	registry.markHandledExtensionsKnown();
	expect(registry.mayHavePluginHandler("book.epub")).toBe(true);
	expect(registry.mayHavePluginHandler("comic.cbz")).toBe(true);
	expect(registry.mayHavePluginHandler("notes.txt")).toBe(false);
});

it("adds handlers registered after the history exists and keeps old ones", () => {
	const { registry, register, storage } = setup(["epub"]);
	expect(registry.mayHavePluginHandler("notes.txt")).toBe(false);
	register("sheets", ["csv"]);
	expect(registry.mayHavePluginHandler("data.csv")).toBe(true);
	expect(registry.mayHavePluginHandler("book.epub")).toBe(true);
	expect(JSON.parse(storage.get("pluginHandledExtensions"))).toEqual([
		"epub",
		"csv",
	]);
});

it("treats a wildcard handler as handling everything", () => {
	const { registry } = setup(["*"]);
	expect(registry.mayHavePluginHandler("anything.txt")).toBe(true);
});

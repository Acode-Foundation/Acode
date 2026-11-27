// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FileSystem } from "../../src/native/file/entries";
import toInternalURL from "../../src/native/file/internalUrl";

const PKG = "com.foxdebug.acode";
// Registration order of Android's filesystems (requestAllFileSystems).
const ROOTS: [string, string][] = [
	["temporary", `file:///data/user/0/${PKG}/cache/`],
	["persistent", `file:///storage/emulated/0/`],
	["content", "content://"],
	["assets", "file:///android_asset/"],
	["files", `file:///data/user/0/${PKG}/files/files/`],
	["files-external", `file:///storage/emulated/0/Android/data/${PKG}/files/`],
	["sdcard", "file:///storage/emulated/0/"],
	["cache", `file:///data/user/0/${PKG}/cache/`],
	["cache-external", `file:///storage/emulated/0/Android/data/${PKG}/cache/`],
	["root", "file:///"],
];

let fileSystems: Map<string, FileSystem>;

beforeEach(() => {
	vi.stubGlobal("Bridge", { platformId: "android" });
	vi.stubGlobal("location", {
		origin: "https://localhost",
		protocol: "https:",
		host: "localhost",
	});
	fileSystems = new Map(
		ROOTS.map(([name, nativeURL]) => [
			name,
			new FileSystem(name, { name, fullPath: "/", nativeURL }),
		]),
	);
});
afterEach(() => vi.unstubAllGlobals());

const external = `file:///storage/emulated/0/Android/data/${PKG}/files`;

it("formats files and directories like Android's shortest-match resolver", () => {
	expect(
		toInternalURL(fileSystems, `${external}/plugins/acode.git/main.js`),
	).toBe(
		"https://localhost/__cdvfile_files-external__/plugins/acode.git/main.js",
	);
	expect(
		toInternalURL(fileSystems, `${external}/plugins/acode.git`, true),
	).toBe("https://localhost/__cdvfile_files-external__/plugins/acode.git/");
	expect(
		toInternalURL(fileSystems, `file:///data/user/0/${PKG}/cache/x.json`),
	).toBe("https://localhost/__cdvfile_cache__/x.json");
	expect(
		toInternalURL(fileSystems, "file:///storage/emulated/0/My Code/a.js"),
	).toBe("https://localhost/__cdvfile_sdcard__/My%20Code/a.js");
});

it("defers to the native resolver when the result could differ", () => {
	for (const url of [
		`${external}/plugins/%E2%9C%93/a.js`,
		`${external}/plugins/ünï/a.js`,
		`${external}/plugins/../settings.json`,
		`${external}//plugins/a.js`,
		`${external}/a.js?x=1`,
		"content://com.android.providers/document/1",
		"file:///storage/emulated/0x/a.js",
	])
		expect(toInternalURL(fileSystems, url), url).toBeNull();

	vi.stubGlobal("Bridge", { platformId: "ios" });
	expect(toInternalURL(fileSystems, `${external}/a.js`)).toBeNull();
	vi.stubGlobal("Bridge", { platformId: "android" });
	expect(toInternalURL(new Map(), `${external}/a.js`)).toBeNull();
});

it("defers when a root matches only as a string prefix of a sibling", () => {
	fileSystems.set(
		"docs",
		new FileSystem("docs", {
			name: "docs",
			fullPath: "/",
			nativeURL: "file:///storage/emulated/0/Doc/",
		}),
	);
	expect(
		toInternalURL(fileSystems, "file:///storage/emulated/0/Docs/a.js"),
	).toBeNull();
});

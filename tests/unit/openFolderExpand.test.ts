// @vitest-environment happy-dom

import tag from "html-tag-js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

type Read = {
	resolve: (entries: unknown[]) => void;
	reject: (error: unknown) => void;
};

const fs = vi.hoisted(() => ({ reads: [] as Read[] }));
const files = vi.hoisted(() => ({ container: null as HTMLElement | null }));
const helpersError = vi.hoisted(() => vi.fn());

vi.mock("fileSystem", () => ({
	default: () => ({
		lsDir: () =>
			new Promise((resolve, reject) => fs.reads.push({ resolve, reject })),
	}),
}));
vi.mock("sidebarApps", () => ({ default: { get: () => files.container } }));
vi.mock("sidebarApps/files", () => ({ fixHeight: vi.fn() }));
vi.mock("sidebarApps/files/selection", () => ({
	default: { onAction: vi.fn(), start: vi.fn() },
}));
vi.mock("components/sidebar", () => ({ default: { hide: vi.fn() } }));
vi.mock("components/toast", () => ({ default: vi.fn() }));
vi.mock("dialogs/alert", () => ({ default: vi.fn() }));
vi.mock("dialogs/confirm", () => ({ default: vi.fn() }));
vi.mock("dialogs/prompt", () => ({ default: vi.fn() }));
vi.mock("dialogs/select", () => ({ default: vi.fn() }));
vi.mock("lib/fileIcons", () => ({ default: { onChange: vi.fn() } }));
vi.mock("lib/fileList", () => ({
	addRoot: vi.fn(async () => {}),
	append: vi.fn(),
	remove: vi.fn(),
	rename: vi.fn(),
}));
vi.mock("lib/lazyImports", () => ({ loadFileBrowser: vi.fn() }));
vi.mock("lib/openFile", () => ({ default: vi.fn() }));
vi.mock("lib/recents", () => ({
	default: { addFolder: vi.fn(), removeFile: vi.fn(), removeFolder: vi.fn() },
}));
vi.mock("lib/settings", () => ({
	default: { value: { fileBrowser: { listFiles: false } } },
}));
vi.mock("utils/copyEntry", () => ({ default: vi.fn() }));
vi.mock("utils/helpers", () => ({
	default: {
		getIconForFile: () => "icon file",
		getIconForFolder: () => "icon folder",
		sortDir: (entries: unknown[]) => entries,
		error: helpersError,
		isFile: (type: string) => type === "file",
		isDir: (type: string) => type === "dir",
	},
}));

const ROOT = "file:///project";

beforeEach(() => {
	vi.resetModules();
	fs.reads = [];
	files.container = document.createElement("div");
	helpersError.mockClear();
	// tile() and other components use the app's global `tag`.
	vi.stubGlobal("tag", tag);
	vi.stubGlobal("strings", {});
	vi.stubGlobal("editorManager", { emit: vi.fn(), onupdate: vi.fn() });
	// Helpers the app gets from the html-tag-js polyfill and utils/polyfill.
	for (const [name, value] of [
		[
			"get",
			function (this: HTMLElement, selector: string) {
				return this.querySelector(selector);
			},
		],
		[
			"getAll",
			function (this: HTMLElement, selector: string) {
				return this.querySelectorAll(selector);
			},
		],
	] as const) {
		if (!(name in HTMLElement.prototype)) {
			Object.defineProperty(HTMLElement.prototype, name, {
				configurable: true,
				value,
			});
		}
	}
	if (!("hashCode" in String.prototype)) {
		Object.defineProperty(String.prototype, "hashCode", {
			configurable: true,
			value: () => 1,
		});
	}
});
afterEach(() => vi.unstubAllGlobals());

/**
 * Open a root folder and toggle it expand → collapse → expand, leaving two
 * directory reads pending: the stale one and the latest one.
 */
async function openAndToggle() {
	const { default: openFolder } = await import("lib/openFolder");
	openFolder(ROOT, { name: "project", saveState: false, listFiles: false });
	const { $node: $root } = openFolder.find(ROOT);

	$root.expand();
	$root.collapse();
	$root.expand();
	expect(fs.reads).toHaveLength(2);

	const [stale, latest] = fs.reads;
	return { $root, stale, latest };
}

const entry = (name: string) => ({
	name,
	url: `${ROOT}/${name}`,
	isFile: true,
});

const rendered = ($root: HTMLElement & { $ul: HTMLElement }) =>
	Array.from($root.$ul.querySelectorAll<HTMLElement>('[data-type="file"]')).map(
		($el) => $el.dataset.name,
	);

const isLoading = ($root: HTMLElement & { $title: HTMLElement }) =>
	$root.$title.classList.contains("loading");

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

it("renders only the latest tree when the stale read finishes first", async () => {
	const { $root, stale, latest } = await openAndToggle();

	stale.resolve([entry("stale.txt")]);
	await flush();
	expect(rendered($root)).toEqual([]);
	expect(isLoading($root)).toBe(true);

	latest.resolve([entry("latest.txt")]);
	await flush();
	expect(rendered($root)).toEqual(["latest.txt"]);
	expect(isLoading($root)).toBe(false);
});

it("renders only the latest tree when the stale read finishes last", async () => {
	const { $root, stale, latest } = await openAndToggle();

	latest.resolve([entry("latest.txt")]);
	await flush();
	expect(rendered($root)).toEqual(["latest.txt"]);
	expect(isLoading($root)).toBe(false);

	stale.resolve([entry("stale.txt")]);
	await flush();
	expect(rendered($root)).toEqual(["latest.txt"]);
	expect(isLoading($root)).toBe(false);
});

it("ignores a failed stale read instead of collapsing the folder", async () => {
	const { $root, stale, latest } = await openAndToggle();

	stale.reject(new Error("connection lost"));
	await flush();
	expect($root.collapsed).toBe(false);
	expect(helpersError).not.toHaveBeenCalled();
	expect(isLoading($root)).toBe(true);

	latest.resolve([entry("latest.txt")]);
	await flush();
	expect(rendered($root)).toEqual(["latest.txt"]);
	expect(isLoading($root)).toBe(false);
});

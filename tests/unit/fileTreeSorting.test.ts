// @vitest-environment happy-dom

import FileTree from "components/fileTree";
import tag from "html-tag-js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	settings: {
		sortByName: true,
		sortBy: "name",
		sortOrder: "asc",
		foldersFirst: true,
		showHiddenFiles: true,
	},
	listener: null as null | (() => void),
}));

vi.mock("utils/helpers", async () => {
	// Only the sorting rule and icons are needed; importing the real helper
	// module would pull in the editor's JSX sources.
	const { getEntryComparator, normalizeSortOrder } = await import(
		"utils/sortEntries"
	);

	return {
		default: {
			getIconForFile: (name: string) => `icon ${name}`,
			getIconForFolder: () => "icon folder",
			isDir: (type: string) => /^(dir|directory|folder)$/.test(type),
			sortDir(list: Array<Record<string, any>>, settings: Record<string, any>) {
				const dir: any[] = [];
				const file: any[] = [];
				for (const item of list) {
					if (typeof item.isDirectory !== "boolean") {
						item.isDirectory = /^(dir|directory|folder)$/.test(item.type);
					}
					if (!item.type) item.type = item.isDirectory ? "dir" : "file";
					(item.isDirectory ? dir : file).push(item);
				}

				const compare = getEntryComparator(
					settings.sortByName === false ? "none" : settings.sortBy,
					normalizeSortOrder(settings.sortOrder),
				);
				if (compare) {
					dir.sort(compare);
					file.sort(compare);
				}

				if (settings.foldersFirst === false) {
					return dir.concat(file).sort(compare || (() => 0));
				}
				return dir.concat(file);
			},
		},
	};
});

beforeEach(() => {
	document.body.replaceChildren();
	vi.stubGlobal("tag", tag);
	vi.stubGlobal("app", document.body);
	vi.stubGlobal("strings", {});
	state.settings = {
		sortByName: true,
		sortBy: "name",
		sortOrder: "asc",
		foldersFirst: true,
		showHiddenFiles: true,
	};
});

afterEach(() => vi.unstubAllGlobals());

const entries = () => [
	{ name: "notes.md", url: "/root/notes.md", isFile: true, size: 10 },
	{ name: "alpha", url: "/root/alpha", isDirectory: true, size: 0 },
	{ name: "zebra.txt", url: "/root/zebra.txt", isFile: true, size: 900 },
	{ name: "beta.md", url: "/root/beta.md", isFile: true, size: 200 },
];

const names = (container: HTMLElement) =>
	[...container.querySelectorAll<HTMLElement>("[data-name]")].map(
		($el) => $el.dataset.name,
	);

function createTree() {
	const container = document.createElement("div");
	document.body.append(container);
	const tree = new FileTree(container, {
		getEntries: async () => entries(),
		getSortSettings: () => state.settings,
		onSortChange(listener: null | (() => void)) {
			state.listener = listener;
		},
	});
	return { container, tree };
}

it("re-sorts the editor tree when the sort settings change", async () => {
	const { container, tree } = createTree();
	await tree.load("/root");
	expect(names(container)).toEqual([
		"alpha",
		"beta.md",
		"notes.md",
		"zebra.txt",
	]);

	// Switch to type, then to date, as the user does from the sort menu.
	state.settings = { ...state.settings, sortBy: "type" };
	state.listener?.();
	expect(names(container)).toEqual([
		"alpha",
		"beta.md",
		"notes.md",
		"zebra.txt",
	]);

	state.settings = { ...state.settings, sortBy: "size", sortOrder: "desc" };
	state.listener?.();
	expect(names(container)).toEqual([
		"alpha",
		"zebra.txt",
		"beta.md",
		"notes.md",
	]);
});

it("keeps grouping correct after switching order twice", async () => {
	const { container, tree } = createTree();
	await tree.load("/root");

	// Sort by size descending, where the folder (0 bytes) would naturally lead.
	state.settings = { ...state.settings, sortBy: "size", sortOrder: "desc" };
	state.listener?.();

	// Back to name: folders must still be first, and files alphabetical.
	state.settings = { ...state.settings, sortBy: "name", sortOrder: "asc" };
	state.listener?.();
	expect(names(container)).toEqual([
		"alpha",
		"beta.md",
		"notes.md",
		"zebra.txt",
	]);
});

it("mixes folders with files when foldersFirst is off", async () => {
	const { container, tree } = createTree();
	await tree.load("/root");

	state.settings = {
		...state.settings,
		sortBy: "size",
		sortOrder: "desc",
		foldersFirst: false,
	};
	state.listener?.();
	expect(names(container)).toEqual([
		"zebra.txt",
		"beta.md",
		"notes.md",
		"alpha",
	]);
});

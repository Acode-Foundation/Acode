// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import tag from "html-tag-js";
import FileTree from "components/fileTree";

vi.mock("utils/helpers", () => ({
	default: {
		getIconForFile: (name: string) => name,
		getIconForFolder: (name: string, options: { expanded: boolean }) =>
			`${name}-${options.expanded ? "open" : "closed"}`,
		sortDir: (entries: unknown[]) => entries,
	},
}));
beforeEach(() => vi.stubGlobal("tag", tag));
afterEach(() => vi.unstubAllGlobals());

it("uses the recycled folder's name and URL for toggles and context actions", async () => {
	const getEntries = vi.fn(async () => []);
	const onExpandedChange = vi.fn();
	const onContextMenu = vi.fn();
	const tree = new FileTree(document.createElement("div"), {
		getEntries,
		onExpandedChange,
		onContextMenu,
	});
	const row = tree.createFolderElement("src", "file:///src");
	await row.expand();
	const originalChild = row.fileTree;
	const destroy = vi.spyOn(originalChild, "destroy");
	expect(tree.createFolderElement("assets", "file:///assets", row)).toBe(row);
	expect(destroy).toHaveBeenCalledTimes(1);
	expect(row.fileTree).toBeNull();
	expect(row.$title.firstElementChild.className).toBe("assets-closed");
	await row.expand();
	expect(getEntries).toHaveBeenLastCalledWith("file:///assets");
	expect(row.$title.firstElementChild.className).toBe("assets-open");
	expect(onExpandedChange).toHaveBeenLastCalledWith("file:///assets", true);
	expect(tree.childTrees.has("file:///src")).toBe(false);
	expect(tree.childTrees.has("file:///assets")).toBe(true);
	await row.collapse();
	expect(row.$title.firstElementChild.className).toBe("assets-closed");
	expect(onExpandedChange).toHaveBeenLastCalledWith("file:///assets", false);
	row.$title.dispatchEvent(new Event("contextmenu"));
	expect(onContextMenu).toHaveBeenLastCalledWith(
		"dir",
		"file:///assets",
		"assets",
		row.$title,
	);
	tree.destroy();
});

it("uses recycled file identity for open and context actions", () => {
	const onFileClick = vi.fn();
	const onContextMenu = vi.fn();
	const tree = new FileTree(document.createElement("div"), {
		onFileClick,
		onContextMenu,
	});
	const row = tree.createFileElement("a.js", "file:///a.js");
	tree.createFileElement("b.ts", "file:///b.ts", row);
	row.click();
	row.dispatchEvent(new Event("contextmenu"));
	expect(onFileClick).toHaveBeenCalledWith("file:///b.ts", "b.ts");
	expect(onContextMenu).toHaveBeenCalledWith(
		"file",
		"file:///b.ts",
		"b.ts",
		row,
	);
	tree.destroy();
});

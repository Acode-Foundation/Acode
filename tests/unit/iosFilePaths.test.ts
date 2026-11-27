import { describe, expect, it, vi } from "vitest";
import restorePaths from "../../src/native/file/restorePaths";

describe("iOS saved file paths", () => {
	it("restores sessions, tree keys and recents without changing remote paths or contents", () => {
		const old = "file:///old/Documents";
		const next = "file:///current/Documents";
		const storage = createStorage({
			files: [
				{
					uri: `${old}/hello # 日本語.txt`,
					filename: "hello # 日本語.txt",
					isUnsaved: true,
				},
			],
			folders: [
				{
					url: old,
					opts: { listState: { [old]: true, [`${old}/child`]: false } },
				},
			],
			recentFiles: [
				`${old}/hello.txt`,
				"sftp://profile-1/file",
				`${old}-other/file`,
			],
			recentFolders: [{ url: `${old}/child` }],
			storageList: [{ uri: old }],
			fileBrowserState: [{ url: old, name: "Documents" }],
			unrelated: { text: `Source code mentioning ${old}/file` },
		});
		restorePaths([{ from: old, to: next }], storage);
		expect(JSON.parse(storage.getItem("files")!)).toEqual([
			{
				uri: `${next}/hello # 日本語.txt`,
				filename: "hello # 日本語.txt",
				isUnsaved: true,
			},
		]);
		expect(JSON.parse(storage.getItem("folders")!)[0]).toEqual({
			url: next,
			opts: { listState: { [next]: true, [`${next}/child`]: false } },
		});
		expect(JSON.parse(storage.getItem("recentFiles")!)).toEqual([
			`${next}/hello.txt`,
			"sftp://profile-1/file",
			`${old}-other/file`,
		]);
		expect(JSON.parse(storage.getItem("storageList")!)).toEqual([
			{ uri: next },
		]);
		expect(JSON.parse(storage.getItem("recentFolders")!)).toEqual([
			{ url: `${next}/child` },
		]);
		expect(JSON.parse(storage.getItem("fileBrowserState")!)).toEqual([
			{ url: next, name: "Documents" },
		]);
		expect(JSON.parse(storage.getItem("unrelated")!)).toEqual({
			text: `Source code mentioning ${old}/file`,
		});
		storage.setItem = vi.fn(storage.setItem);
		restorePaths([{ from: old, to: next }], storage);
		expect(storage.setItem).not.toHaveBeenCalled();
	});

	it("prefers the closest root and preserves malformed entries", () => {
		const storage = createStorage({
			recentFiles: ["file:///old/project/a.txt"],
		});
		storage.setItem("files", "invalid json");
		restorePaths(
			[
				{ from: "file:///old", to: "file:///new" },
				{ from: "file:///old/project", to: "file:///provider/renamed" },
			],
			storage,
		);
		expect(JSON.parse(storage.getItem("recentFiles")!)).toEqual([
			"file:///provider/renamed/a.txt",
		]);
		expect(storage.getItem("files")).toBe("invalid json");
	});

	it("keeps startup available when one stored value cannot be written", () => {
		const storage = createStorage({
			files: [{ uri: "file:///old/file.txt" }],
			recentFiles: ["file:///old/file.txt"],
		});
		const write = storage.setItem;
		storage.setItem = (key, value) => {
			if (key === "files") throw new Error("Quota exceeded");
			write(key, value);
		};
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			expect(() =>
				restorePaths([{ from: "file:///old", to: "file:///new" }], storage),
			).not.toThrow();
			expect(JSON.parse(storage.getItem("files")!)[0].uri).toBe(
				"file:///old/file.txt",
			);
			expect(JSON.parse(storage.getItem("recentFiles")!)).toEqual([
				"file:///new/file.txt",
			]);
		} finally {
			warn.mockRestore();
		}
	});

	it("preserves encoded path components and does not relocate current destinations again", () => {
		const storage = createStorage({
			recentFiles: [
				"file:///old%20container/Documents/a%20%23%20%E6%97%A5.txt",
				"file:///old/current/file.txt",
			],
		});
		restorePaths(
			[
				{
					from: "file:///old%20container/Documents",
					to: "file:///current%20container/Documents",
				},
				{ from: "file:///old", to: "file:///old/current" },
			],
			storage,
		);
		expect(JSON.parse(storage.getItem("recentFiles")!)).toEqual([
			"file:///current%20container/Documents/a%20%23%20%E6%97%A5.txt",
			"file:///old/current/file.txt",
		]);
	});
});

function createStorage(values: Record<string, unknown>): Storage {
	const data = new Map(
		Object.entries(values).map(([key, value]) => [key, JSON.stringify(value)]),
	);
	return {
		get length() {
			return data.size;
		},
		getItem: (key) => data.get(key) ?? null,
		setItem: (key, value) => {
			data.set(key, value);
		},
		removeItem: (key) => {
			data.delete(key);
		},
		clear: () => data.clear(),
		key: (index) => [...data.keys()][index] ?? null,
	};
}

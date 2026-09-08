import { EditorState } from "@codemirror/state";
import openFile from "lib/openFile";
import navigateToResult from "sidebarApps/searchInFiles/navigateToResult";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("lib/openFile", () => ({ default: vi.fn() }));

function deferred() {
	let resolve;
	let reject;
	const promise = new Promise((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

const match = {
	start: { row: 1, column: 2 },
	end: { row: 1, column: 5 },
};

describe("project search result navigation", () => {
	let manager;
	let files;

	function addFile(uri, text = "first\n  match here\nlast") {
		const file = {
			uri,
			type: "editor",
			loaded: true,
			loading: false,
			session: EditorState.create({ doc: text }),
			load: vi.fn().mockResolvedValue(undefined),
		};
		files.set(uri, file);
		return file;
	}

	function activate(file) {
		manager.activeFile = file;
		manager.editor = { state: file.session };
	}

	beforeEach(() => {
		files = new Map();
		manager = {
			activeFile: null,
			editor: null,
			getFile: vi.fn((uri) => files.get(uri)),
			revealRange: vi.fn(() => true),
		};
		vi.stubGlobal("editorManager", manager);
		openFile.mockReset();
		openFile.mockImplementation(async (uri, { signal }) => {
			if (signal.aborted) return;
			const file = files.get(uri) || addFile(uri);
			activate(file);
		});
	});

	afterEach(() => vi.unstubAllGlobals());

	it.each([false, true])(
		"reveals the exact match through the scroll-restore-safe API (existing tab: %s)",
		async (existing) => {
			if (existing) addFile("target");
			expect(await navigateToResult("target", match)).toBe(true);
			expect(openFile).toHaveBeenCalledWith("target", {
				render: true,
				signal: expect.any(AbortSignal),
			});
			expect(manager.revealRange).toHaveBeenCalledWith(8, 11, {
				y: "center",
				userEvent: "select.search",
			});
		},
	);

	it("waits for a restored tab's final document instead of its preview", async () => {
		const file = addFile("target", "preview");
		const loading = deferred();
		file.loaded = false;
		file.loading = true;
		file.load.mockImplementation(() => loading.promise);
		const navigation = navigateToResult("target", match);
		await vi.waitFor(() => expect(file.load).toHaveBeenCalled());
		expect(manager.revealRange).not.toHaveBeenCalled();

		file.session = EditorState.create({ doc: "first\n  match here\nlast" });
		file.loaded = true;
		file.loading = false;
		activate(file);
		loading.resolve();
		expect(await navigation).toBe(true);
		expect(manager.revealRange).toHaveBeenCalledWith(8, 11, expect.anything());
	});

	it("reveals the latest result without waiting for an obsolete open", async () => {
		const opening = deferred();
		openFile.mockImplementationOnce(async (uri, { signal }) => {
			await opening.promise;
			if (!signal.aborted) activate(addFile(uri));
		});
		const first = navigateToResult("slow", match);
		await vi.waitFor(() => expect(openFile).toHaveBeenCalledTimes(1));
		const skipped = navigateToResult("intermediate", match);
		const last = navigateToResult("latest", match);
		await expect(last).resolves.toBe(true);
		expect(manager.activeFile.uri).toBe("latest");
		expect(openFile.mock.calls[0][1].signal.aborted).toBe(true);
		opening.resolve();

		expect(await Promise.all([first, skipped, last])).toEqual([
			false,
			false,
			true,
		]);
		expect(openFile.mock.calls.map(([uri]) => uri)).toEqual([
			"slow",
			"intermediate",
			"latest",
		]);
		expect(manager.activeFile.uri).toBe("latest");
		expect(manager.revealRange).toHaveBeenCalledTimes(1);
	});

	it("reveals another file while an obsolete restored tab is still loading", async () => {
		const file = addFile("slow");
		const loading = deferred();
		file.loaded = false;
		file.loading = true;
		file.load.mockImplementation(() => loading.promise);
		const first = navigateToResult("slow", match);
		await vi.waitFor(() => expect(file.load).toHaveBeenCalled());

		await expect(navigateToResult("latest", match)).resolves.toBe(true);
		expect(manager.activeFile.uri).toBe("latest");
		file.loaded = true;
		file.loading = false;
		loading.resolve();
		await expect(first).resolves.toBe(false);
		expect(manager.activeFile.uri).toBe("latest");
		expect(manager.revealRange).toHaveBeenCalledTimes(1);
	});

	it("ignores late failures from an obsolete open", async () => {
		const opening = deferred();
		openFile.mockImplementationOnce(() => opening.promise);
		const first = navigateToResult("slow", match);
		await expect(navigateToResult("latest", match)).resolves.toBe(true);
		opening.reject(new Error("Obsolete read failed"));
		await expect(first).resolves.toBe(false);
		expect(manager.activeFile.uri).toBe("latest");
	});

	it("uses the latest match when the same file is still loading", async () => {
		const file = addFile("target");
		const loading = deferred();
		file.load.mockImplementationOnce(() => loading.promise);
		const first = navigateToResult("target", match);
		await vi.waitFor(() => expect(file.load).toHaveBeenCalled());
		const last = navigateToResult("target", {
			start: { row: 2, column: 0 },
			end: { row: 2, column: 4 },
		});
		loading.resolve();
		expect(await Promise.all([first, last])).toEqual([false, true]);
		expect(manager.revealRange).toHaveBeenCalledExactlyOnceWith(
			19,
			23,
			expect.anything(),
		);
	});

	it.each(["switched", "closed", "failed"])(
		"does not reveal into another document after the target is %s during loading",
		async (action) => {
			const file = addFile("target");
			const loading = deferred();
			file.load.mockImplementation(() => loading.promise);
			const navigation = navigateToResult("target", match);
			await vi.waitFor(() => expect(file.load).toHaveBeenCalled());
			if (action === "switched") activate(addFile("other"));
			if (action === "closed") files.delete("target");
			if (action === "failed") file.loaded = false;
			loading.resolve();
			expect(await navigation).toBe(false);
			expect(manager.revealRange).not.toHaveBeenCalled();
		},
	);

	it.each(["missing", "image"])(
		"does not navigate the previous editor when opening a %s target",
		async (type) => {
			activate(addFile("previous"));
			openFile.mockImplementationOnce(async () => {
				if (type === "image") {
					const file = addFile("target");
					file.type = "image";
					activate(file);
				}
			});
			expect(await navigateToResult("target", match)).toBe(false);
			expect(manager.revealRange).not.toHaveBeenCalled();
		},
	);

	it("handles multiline ranges and clamps stale coordinates", async () => {
		addFile("target", "abc\ndef");
		await navigateToResult("target", {
			start: { row: 0, column: 1 },
			end: { row: 1, column: 2 },
		});
		expect(manager.revealRange).toHaveBeenLastCalledWith(1, 6, expect.anything());
		await navigateToResult("target", {
			start: { row: -1, column: -2 },
			end: { row: 100, column: 100 },
		});
		expect(manager.revealRange).toHaveBeenLastCalledWith(0, 7, expect.anything());
	});

	it("continues navigating after an open rejects", async () => {
		openFile.mockRejectedValueOnce(new Error("Read failed"));
		await expect(navigateToResult("broken", match)).rejects.toThrow("Read failed");
		expect(await navigateToResult("target", match)).toBe(true);
		expect(manager.activeFile.uri).toBe("target");
	});
});

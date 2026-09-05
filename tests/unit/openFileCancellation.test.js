import fs from "node:fs";
import ts from "typescript";
import { beforeEach, describe, expect, it, vi } from "vitest";

// openFile contains app-specific JSX. Compile the actual module for this
// isolated test, supplying its Cordova/UI dependencies without booting the app.
const source = fs.readFileSync(
	new URL("../../src/lib/openFile.js", import.meta.url),
	"utf8",
);
const { outputText } = ts.transpileModule(source, {
	fileName: "openFile.jsx",
	compilerOptions: {
		module: ts.ModuleKind.CommonJS,
		target: ts.ScriptTarget.ES2020,
		jsx: ts.JsxEmit.React,
	},
});

function deferred() {
	let resolve;
	const promise = new Promise((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

describe("openFile cancellation", () => {
	let openFile;
	let manager;
	let stat;
	let readFile;
	let decode;
	let detectEncoding;
	let handler;
	let createEditor;
	let recents;
	let controller;
	let titleLoader;
	let loaderVisible;

	beforeEach(() => {
		controller = new AbortController();
		loaderVisible = false;
		titleLoader = {
			showTitleLoader: vi.fn(() => {
				loaderVisible = true;
			}),
			removeTitleLoader: vi.fn(() => {
				loaderVisible = false;
			}),
		};
		manager = { getFile: vi.fn(), activeFile: null };
		stat = vi.fn().mockResolvedValue({ name: "target.txt", length: 10 });
		readFile = vi.fn().mockResolvedValue("bytes");
		decode = vi.fn().mockResolvedValue("target text");
		detectEncoding = vi.fn().mockResolvedValue("UTF-8");
		handler = { getFileHandler: vi.fn() };
		recents = { addFile: vi.fn() };
		createEditor = vi.fn(function (name, options) {
			manager.activeFile = { name, ...options };
		});
		const dependencies = {
			fileSystem: { default: () => ({ stat, readFile }) },
			"@codemirror/state": {},
			"components/audioPlayer": {},
			"dialogs/alert": {},
			"dialogs/confirm": {},
			"dialogs/loader": {
				default: titleLoader,
			},
			"palettes/changeEncoding": {},
			"utils/encodings": { decode, detectEncoding },
			"utils/helpers": {
				default: { getStatMtime: () => 0, isBinary: () => false },
			},
			"./editorFile": { default: createEditor },
			"./fileSessionPersistence": { promoteSessionPersistence: vi.fn() },
			"./fileTypeHandler": { default: handler },
			"./recents": { default: recents },
			"./settings": {
				default: { value: { maxFileSize: 10, defaultFileEncoding: "auto" } },
			},
		};
		const exports = {};
		new Function("require", "exports", "editorManager", outputText)(
			(name) => {
				if (!(name in dependencies)) throw new Error(`Unexpected import: ${name}`);
				return dependencies[name];
			},
			exports,
			manager,
		);
		openFile = exports.default;
	});

	it("preserves normal file opening without a signal", async () => {
		await openFile("target", { render: true });
		expect(createEditor).toHaveBeenCalledOnce();
		expect(manager.activeFile.text).toBe("target text");
		expect(recents.addFile).toHaveBeenCalledWith("target");
	});

	it("does not activate an existing file with an already-aborted signal", async () => {
		const file = { makeActive: vi.fn() };
		manager.getFile.mockReturnValue(file);
		controller.abort();
		await openFile("target", { render: true, signal: controller.signal });
		expect(file.makeActive).not.toHaveBeenCalled();
	});

	it.each(["stat", "read", "detect", "decode"])(
		"does not steal focus when cancelled during %s",
		async (stage) => {
			const waiting = deferred();
			const operation = { stat, read: readFile, detect: detectEncoding, decode }[
				stage
			];
			operation.mockReturnValueOnce(waiting.promise);
			const opening = openFile("obsolete", {
				render: true,
				signal: controller.signal,
			});
			await vi.waitFor(() => expect(operation).toHaveBeenCalledOnce());
			controller.abort();

			// A newer open completes before the obsolete filesystem work does.
			await openFile("latest", { render: true });
			const latest = manager.activeFile;
			waiting.resolve(
				stage === "stat" ? { name: "obsolete.txt", length: 10 } : "text",
			);
			await opening;
			expect(manager.activeFile).toBe(latest);
			expect(createEditor).toHaveBeenCalledOnce();
			expect(recents.addFile).toHaveBeenCalledExactlyOnceWith("latest");
		},
	);

	it("guards a custom handler's delayed createEditor callback", async () => {
		const waiting = deferred();
		const handleFile = vi.fn(async ({ options }) => {
			await waiting.promise;
			options.createEditor(false, "obsolete text");
		});
		handler.getFileHandler.mockReturnValue({ handleFile });
		const opening = openFile("obsolete", { signal: controller.signal });
		await vi.waitFor(() => expect(handleFile).toHaveBeenCalledOnce());
		controller.abort();
		waiting.resolve();
		await opening;
		expect(createEditor).not.toHaveBeenCalled();
	});

	it("keeps the latest loader visible when an aborted earlier read settles", async () => {
		const obsoleteRead = deferred();
		const latestRead = deferred();
		readFile.mockReturnValueOnce(obsoleteRead.promise);
		readFile.mockReturnValueOnce(latestRead.promise);
		const obsolete = openFile("obsolete", { signal: controller.signal });
		await vi.waitFor(() => expect(readFile).toHaveBeenCalledTimes(1));
		controller.abort();
		const latest = openFile("latest");
		await vi.waitFor(() => expect(readFile).toHaveBeenCalledTimes(2));
		expect(loaderVisible).toBe(true);
		const removals = titleLoader.removeTitleLoader.mock.calls.length;

		obsoleteRead.resolve("obsolete bytes");
		await obsolete;
		expect(loaderVisible).toBe(true);
		expect(titleLoader.removeTitleLoader).toHaveBeenCalledTimes(removals);
		latestRead.resolve("latest bytes");
		await latest;
		expect(loaderVisible).toBe(false);
	});

	it.each([0, 1])(
		"keeps the indicator until both concurrent opens finish (first to finish: %s)",
		async (first) => {
			const reads = [deferred(), deferred()];
			readFile.mockReturnValueOnce(reads[0].promise);
			readFile.mockReturnValueOnce(reads[1].promise);
			const opens = [openFile("one"), openFile("two")];
			await vi.waitFor(() => expect(readFile).toHaveBeenCalledTimes(2));
			reads[first].resolve("bytes");
			await opens[first];
			expect(loaderVisible).toBe(true);
			expect(titleLoader.removeTitleLoader).not.toHaveBeenCalled();
			reads[1 - first].resolve("bytes");
			await opens[1 - first];
			expect(loaderVisible).toBe(false);
			expect(titleLoader.removeTitleLoader).toHaveBeenCalledOnce();
		},
	);

	it("releases a cancelled open's loader without waiting for its read", async () => {
		const reading = deferred();
		readFile.mockReturnValueOnce(reading.promise);
		const opening = openFile("target", { signal: controller.signal });
		await vi.waitFor(() => expect(readFile).toHaveBeenCalledOnce());
		expect(loaderVisible).toBe(true);
		controller.abort();
		expect(loaderVisible).toBe(false);
		expect(titleLoader.removeTitleLoader).toHaveBeenCalledOnce();
		reading.resolve("bytes");
		await opening;
		expect(titleLoader.removeTitleLoader).toHaveBeenCalledOnce();
	});

	it("does not hide another open's loader when activating an existing tab", async () => {
		const reading = deferred();
		readFile.mockReturnValueOnce(reading.promise);
		const opening = openFile("loading");
		await vi.waitFor(() => expect(readFile).toHaveBeenCalledOnce());
		manager.getFile.mockReturnValue({ makeActive: vi.fn() });
		await openFile("existing");
		expect(loaderVisible).toBe(true);
		expect(titleLoader.removeTitleLoader).not.toHaveBeenCalled();
		reading.resolve("bytes");
		await opening;
		expect(loaderVisible).toBe(false);
	});
});

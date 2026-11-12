import fs from "node:fs";
import { Text } from "@codemirror/state";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isBinaryFile } from "../../src/utils/binaryExtensions";

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

const AUTO_SAVE = Symbol("auto-save");

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
	let settings;

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
		settings = { maxFileSize: 10, defaultFileEncoding: "auto" };
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
			"@codemirror/state": { Text },
			"components/audioPlayer": {},
			"dialogs/alert": {},
			"dialogs/confirm": {},
			"dialogs/loader": {
				default: titleLoader,
			},
			"palettes/changeEncoding": {},
			"utils/encodings": { decode, detectEncoding },
			"utils/helpers": {
				default: { getStatMtime: () => 0, isBinary: isBinaryFile },
			},
			"./editorFile": { default: createEditor, AUTO_SAVE },
			"./fileSessionPersistence": { promoteSessionPersistence: vi.fn() },
			"./fileTypeHandler": { default: handler },
			"./recents": { default: recents },
			"./settings": { default: { value: settings } },
		};
		const exports = {};
		new Function("require", "exports", "editorManager", outputText)(
			(name) => {
				if (!(name in dependencies))
					throw new Error(`Unexpected import: ${name}`);
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

	it.each([
		"pdf",
		"docx",
		"dotx",
		"xlsx",
		"xls",
		"ods",
		"pptx",
		"ppsx",
		"potx",
	])("requires a handler for external %s documents using the provider filename", async (extension) => {
		stat.mockResolvedValue({
			name: `Document.${extension.toUpperCase()}`,
			canWrite: false,
		});
		await expect(
			openFile("content://provider/42", { external: true }),
		).rejects.toMatchObject({ code: "DOCUMENT_HANDLER_UNAVAILABLE" });
		expect(readFile).not.toHaveBeenCalled();
		expect(createEditor).not.toHaveBeenCalled();
		expect(loaderVisible).toBe(false);
	});

	it("routes granted read-only documents and propagates handler failures instead of decoding bytes", async () => {
		const handleFile = vi.fn(async () => {});
		stat.mockResolvedValue({ name: "Shared.docx", canWrite: false });
		handler.getFileHandler.mockReturnValue({ id: "docs", handleFile });
		await openFile("content://provider/42", { external: true });
		expect(handleFile).toHaveBeenCalledWith(
			expect.objectContaining({ name: "Shared.docx", readOnly: true }),
		);
		handleFile.mockRejectedValueOnce(Error("Engine failed"));
		vi.spyOn(console, "error").mockImplementation(() => {});
		await expect(
			openFile("content://provider/42", { external: true }),
		).rejects.toMatchObject({ filename: "Shared.docx" });
		expect(readFile).not.toHaveBeenCalled();
		expect(createEditor).not.toHaveBeenCalled();
		expect(loaderVisible).toBe(false);
	});

	it.each([
		["Quarterly report", "type", " Application/PDF; charset=binary "],
		[
			"Budget",
			"mime",
			"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		],
		[
			"Letter",
			"type",
			"application/vnd.openxmlformats-officedocument.wordprocessingml.template",
		],
		[
			"Slides",
			"mime",
			"application/vnd.openxmlformats-officedocument.presentationml.slideshow",
		],
		[
			"Template",
			"type",
			"application/vnd.openxmlformats-officedocument.presentationml.template",
		],
		["archive.zip", "type", "text/plain"],
	])("rejects external binary %s before reading or decoding", async (name, field, mime) => {
		stat.mockResolvedValue({
			name,
			[field]: mime,
			canWrite: true,
			url: "content://provider/42",
		});
		await expect(
			openFile("content://provider/42", { external: true }),
		).rejects.toMatchObject({
			message: "Unsupported file",
			filename: name,
		});
		expect(readFile).not.toHaveBeenCalled();
		expect(decode).not.toHaveBeenCalled();
		expect(createEditor).not.toHaveBeenCalled();
		expect(loaderVisible).toBe(false);
	});

	it.each([
		["README", "text/plain"],
		["Makefile", undefined],
		["plain.txt", "application/octet-stream"],
		["plain.csv", "application/octet-stream"],
		["plain.tsv", "application/octet-stream"],
	])("retains the normal %s editor fallback for incoming files", async (name, type) => {
		stat.mockResolvedValue({ name, type, url: "content://provider/plain" });
		await openFile("content://provider/plain", { external: true });
		expect(createEditor).toHaveBeenCalledOnce();
		expect(manager.activeFile.text).toBe("target text");
	});

	it("preserves handlers and internal opens for extensionless files with binary metadata", async () => {
		stat.mockResolvedValue({
			name: "Report",
			type: "application/pdf",
			canWrite: false,
		});
		const handleFile = vi.fn(async () => {});
		handler.getFileHandler.mockReturnValueOnce({ id: "custom", handleFile });
		await openFile("content://provider/report", { external: true });
		expect(handleFile).toHaveBeenCalledWith(
			expect.objectContaining({ name: "Report", readOnly: true }),
		);
		expect(readFile).not.toHaveBeenCalled();
		expect(createEditor).not.toHaveBeenCalled();
		await openFile("content://provider/report");
		expect(createEditor).toHaveBeenCalledOnce();
	});

	it("reports expired grants and reuses already-open custom tabs without replacing their content", async () => {
		stat.mockRejectedValueOnce(Error("Grant expired"));
		await expect(
			openFile("content://provider/42", { external: true }),
		).rejects.toThrow("Grant expired");
		const existing = { makeActive: vi.fn() };
		manager.getFile.mockReturnValueOnce(existing);
		await openFile("content://provider/42", { external: true });
		expect(existing.makeActive).toHaveBeenCalledOnce();
		expect(stat).toHaveBeenCalledTimes(1);
		expect(createEditor).not.toHaveBeenCalled();
	});

	it("does not activate an existing file with an already-aborted signal", async () => {
		const file = { makeActive: vi.fn() };
		manager.getFile.mockReturnValue(file);
		controller.abort();
		await openFile("target", { render: true, signal: controller.signal });
		expect(file.makeActive).not.toHaveBeenCalled();
	});

	it.each([
		"stat",
		"read",
		"detect",
		"decode",
	])("does not steal focus when cancelled during %s", async (stage) => {
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
	});

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

	it.each([
		0, 1,
	])("keeps the indicator until both concurrent opens finish (first to finish: %s)", async (first) => {
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
	});

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

	function openTab(text) {
		const file = {
			loaded: true,
			makeActive: vi.fn(),
			session: {
				doc: Text.of(text.split("\n")),
				setValue: vi.fn(),
			},
		};
		manager.getFile.mockReturnValue(file);
		manager.editor = { dispatch: vi.fn(), state: { doc: { length: 0 } } };
		return file;
	}

	it("updates an open tab in the background without switching to it", async () => {
		const file = openTab("foo");
		await openFile("target", { render: false, text: "bar" });
		expect(file.makeActive).not.toHaveBeenCalled();
		expect(file.session.setValue).toHaveBeenCalledWith("bar");
		expect(manager.editor.dispatch).not.toHaveBeenCalled();
	});

	it("leaves an open tab alone in the background when the text is the same", async () => {
		const file = openTab("foo");
		await openFile("target", { render: false, text: "foo" });
		expect(file.makeActive).not.toHaveBeenCalled();
		expect(file.session.setValue).not.toHaveBeenCalled();
	});

	it("still switches to an open tab when it should render", async () => {
		const file = openTab("foo");
		await openFile("target", { text: "bar" });
		expect(file.makeActive).toHaveBeenCalledOnce();
		expect(manager.editor.dispatch).toHaveBeenCalledOnce();
	});
	it("edits the live view of a split pane that shows the tab", async () => {
		const file = openTab("foo");
		file.id = "tab";
		const paneEditor = {
			dispatch: vi.fn(),
			state: { doc: { length: 3 } },
		};
		manager.panes = [
			{ editor: manager.editor, activeFile: { id: "other" } },
			{ editor: paneEditor, activeFile: file },
		];
		await openFile("target", { render: false, text: "bar" });
		expect(file.makeActive).not.toHaveBeenCalled();
		expect(paneEditor.dispatch).toHaveBeenCalledWith({
			changes: { from: 0, to: 3, insert: "bar" },
		});
		expect(file.session.setValue).not.toHaveBeenCalled();
		expect(manager.editor.dispatch).not.toHaveBeenCalled();
	});

	describe("autosave of background tabs", () => {
		function hiddenTab() {
			const file = openTab("foo");
			file.id = "tab";
			file.uri = "file:///tab.txt";
			file.isUnsaved = true;
			file.save = vi.fn().mockResolvedValue(true);
			manager.panes = [{ editor: manager.editor, activeFile: { id: "x" } }];
			return file;
		}

		beforeEach(() => {
			vi.useFakeTimers();
			settings.autosave = 1000;
		});

		afterEach(() => {
			vi.useRealTimers();
		});

		it("saves a hidden tab after the autosave delay", async () => {
			const file = hiddenTab();
			manager.getFile.mockImplementation((key, type) =>
				type === "id" ? (key === file.id ? file : undefined) : file,
			);
			await openFile("target", { render: false, text: "bar" });
			expect(file.session.setValue).toHaveBeenCalledWith("bar");
			expect(file.save).not.toHaveBeenCalled();
			vi.advanceTimersByTime(1000);
			expect(file.save).toHaveBeenCalledWith(AUTO_SAVE);
		});

		it("does not save a hidden tab that was closed meanwhile", async () => {
			const file = hiddenTab();
			await openFile("target", { render: false, text: "bar" });
			manager.getFile.mockReturnValue(undefined);
			vi.advanceTimersByTime(1000);
			expect(file.save).not.toHaveBeenCalled();
		});

		it("does not save when autosave is off", async () => {
			settings.autosave = 0;
			const file = hiddenTab();
			await openFile("target", { render: false, text: "bar" });
			vi.advanceTimersByTime(10000);
			expect(file.save).not.toHaveBeenCalled();
		});
	});
});

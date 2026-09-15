// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { parse } from "@babel/parser";
import { Compartment, EditorSelection, EditorState } from "@codemirror/state";
import { EditorView, placeholder } from "@codemirror/view";
import {
	blurEditorIfReadOnly,
	createEditorReadOnlyExtension,
} from "cm/editorReadOnly";
import tag from "html-tag-js";
import { readRemoteFilePreview } from "utils/remoteFilePreview";
import { afterEach, expect, it, vi } from "vitest";
import { loadSourceModule } from "../helpers/loadSourceModule";

afterEach(() => {
	vi.clearAllTimers();
	vi.useRealTimers();
	document.body.replaceChildren();
});

const managerSource = readFileSync("src/lib/editorManager.js", "utf8");
const managerBody = parse(managerSource, {
	sourceType: "module",
	plugins: ["jsx"],
}).program.body.find(
	(node) =>
		node.type === "FunctionDeclaration" && node.id.name === "EditorManager",
).body.body;

function setup() {
	vi.useFakeTimers();
	const cache = new Map([["file:///local.js", "local content"]]);
	const read = vi.fn(async (uri) => cache.get(uri));
	const write = vi.fn(async (uri, text) => cache.set(uri, text));
	const remote = {
		exists: async () => true,
		stat: async () => ({}),
		readFile: vi.fn(async () => "remote content"),
	};
	const remoteFactory = vi.fn(() => remote);
	const localFs = (uri) => ({
		exists: async () => cache.has(uri),
		readFile: (encoding) => read(uri, encoding),
		stat: async () => ({}),
		writeFile: (text) => write(uri, text),
		createFile: (name, text) => write(`${uri}/${name}`, text),
		delete: async () => cache.delete(uri),
	});
	const url = {
		join: (...parts) => parts.join("/"),
		basename: (value) => value.split("/").at(-1),
		getProtocol: (value) => `${value.split(":")[0]}:`,
	};
	const filesystem = loadSourceModule("src/fileSystem/index.js", {
		"lib/ajax": { get: remote.readFile },
		"utils/encodings": { decode: (value) => value },
		"utils/Url": url,
		"./internalFs": {
			test: (uri) => uri.startsWith("file:"),
			createFs: localFs,
		},
		"./externalFs": {
			test: (uri) => uri.startsWith("content:"),
			createFs: localFs,
		},
		"./ftp": {
			test: (uri) => uri.startsWith("ftp:"),
			fromUrl: remoteFactory,
		},
		"./sftp": {
			test: (uri) => uri.startsWith("sftp:"),
			fromUrl: remoteFactory,
		},
	});
	const { default: fs, onProviderRegistered } = filesystem;
	const settings = { value: {}, on: vi.fn(), off: vi.fn() };
	const manager = {
		files: [],
		activeFile: null,
		header: {},
		emit: vi.fn(),
		onupdate: vi.fn(),
		getFile: (id, key = "id") => manager.files.find((file) => file[key] === id),
		addFile: (file) => manager.files.push(file),
	};
	// Use the actual registration handler, with the same registry used by EditorFile.
	const registration = managerBody.find(
		(node) =>
			node.type === "ExpressionStatement" &&
			node.expression.callee?.name === "onProviderRegistered",
	);
	vm.runInNewContext(
		managerSource.slice(registration.start, registration.end),
		{ onProviderRegistered, manager, console },
	);
	const toast = vi.fn(),
		log = vi.fn();
	const helpers = {
		normalizeMtime: (value) => value ?? null,
		getStatMtime: () => null,
		getIconForFile: () => "file",
		getVirtualPath: (value) => value,
		fixFilename: (value) => value,
	};
	const selectLocation = vi.fn(async () => ({
		val: { url: "file:///export" },
	}));
	const { default: saveFile } = loadSourceModule(
		"src/lib/saveFile.js",
		{
			fileSystem: filesystem,
			"cm/editorUtils": { getDocText: (doc) => doc.toString() },
			"components/toast": toast,
			"dialogs/prompt": async () => "",
			"dialogs/select": {},
			"lib/recents": { select: selectLocation },
			"pages/fileBrowser": {},
			"utils/helpers": helpers,
			"utils/Url": url,
			"./config": {},
			"./editorFile": {},
			"./openFolder": {},
			"./settings": settings,
		},
		{ editorManager: manager, strings: {} },
	);
	const unused = Object.fromEntries(
		[
			"components/quickTools",
			"dialogs/confirm",
			"handlers/editorFileTab",
			"handlers/quickTools",
			"handlers/tabContextMenu",
			"dompurify",
			"mime-types",
			"utils/codeHighlight",
			"utils/Path",
			"./openFolder",
			"./run",
			"cm/editorReadOnly",
			"lib/quickToolsAdapter",
		].map((id) => [id, {}]),
	);
	const { default: EditorFile } = loadSourceModule(
		"src/lib/editorFile.js",
		{
			...unused,
			fileSystem: filesystem,
			"@codemirror/state": { EditorState, EditorSelection },
			"cm/editorUtils": { getDocText: (doc) => doc.toString() },
			"cm/modelist": {
				getModeForPath: () => "text",
				getMode: () => ({ name: "text" }),
			},
			"components/sidebar": { hide: vi.fn() },
			"components/toast": toast,
			"components/tile": () => {
				const tile = document.createElement("li");
				tile.innerHTML = '<span class="text"></span>';
				tile.tail = vi.fn();
				return tile;
			},
			"html-tag-js": tag,
			"utils/Url": url,
			"utils/remoteFilePreview": { readRemoteFilePreview },
			"utils/helpers": helpers,
			"./config": { DEFAULT_FILE_SESSION: "default" },
			"./loadPlugins": { isInitialPluginLoadComplete: () => false },
			"./settings": settings,
			"./saveFile": saveFile,
		},
		{
			document,
			window: { log },
			tag,
			editorManager: manager,
			CACHE_STORAGE: "file:///cache",
			strings: {},
		},
	);
	EditorFile.prototype.setMode = vi.fn();
	EditorFile.prototype.render = function () {
		manager.activeFile = this;
	};
	const { default: restoreFiles } = loadSourceModule(
		"src/lib/restoreFiles.js",
		{ fileSystem: filesystem, "./editorFile": EditorFile },
	);
	return {
		cache,
		read,
		write,
		remote,
		remoteFactory,
		fs,
		manager,
		toast,
		log,
		selectLocation,
		restoreFiles,
	};
}

it("restores populated and empty recovery caches as usable documents for every filesystem", async () => {
	const f = setup();
	const records = [
		"file",
		"content",
		"ftp",
		"sftp",
		"https",
		"gh",
		"plugin",
	].map((protocol, index) => {
		const text = index % 2 ? "unsaved content" : "";
		f.cache.set(`file:///cache/${protocol}`, text);
		return {
			id: protocol,
			filename: "file.js",
			uri: `${protocol}://example/file.js`,
			render: protocol === "gh",
			isUnsaved: !!text,
			docVersion: 7,
			savedVersion: text ? 4 : 7,
			cacheVersion: 7,
			savedMtime: 100,
			diskMtime: 200,
			hasDiskConflict: !!text,
			pinned: true,
			editable: protocol !== "https",
			encoding: "utf-16le",
			scrollTop: 120,
			cursorPos: { ranges: [{ from: text ? 5 : 0, to: text ? 5 : 0 }] },
		};
	});
	await f.restoreFiles(records);
	await Promise.all(f.manager.files.map((file) => file.load()));
	for (const [index, file] of f.manager.files.entries()) {
		const record = records[index];
		expect(file.loaded).toBe(true);
		expect(file.loading).toBe(false);
		expect(file.session.doc.toString()).toBe(f.cache.get(file.cacheFile));
		expect(file.session.selection.main.head).toBe(
			record.cursorPos.ranges[0].to,
		);
		for (const key of [
			"isUnsaved",
			"docVersion",
			"savedVersion",
			"cacheVersion",
			"savedMtime",
			"diskMtime",
			"hasDiskConflict",
			"pinned",
			"editable",
			"encoding",
		])
			expect(file[key]).toBe(record[key]);
		expect(file.lastScrollTop).toBe(120);
		expect(file.canSave).toBe(true);
		expect(f.read).toHaveBeenCalledWith(file.cacheFile, "utf-16le");
	}
	const github = f.manager.activeFile;
	await github.save();
	expect(f.toast).toHaveBeenCalledWith("File provider unavailable");
	await github.saveAs(); // Cancelling the filename prompt still proves Save As is available.
	expect(f.selectLocation).toHaveBeenCalledOnce();
	github.session = EditorState.create({ doc: "new offline edit" });
	github.markEdited();
	await github.writeToCache();
	expect(f.cache.get(github.cacheFile)).toBe("new offline edit");
	expect(github.isUnsaved).toBe(true);
	f.fs.extend((uri) => /^(gh|plugin):/.test(uri), f.remoteFactory);
	await vi.runAllTimersAsync();
	expect(f.remoteFactory).not.toHaveBeenCalled();
	expect(f.remote.readFile).not.toHaveBeenCalled();
	expect(f.log).not.toHaveBeenCalled();
});

it("keeps uncached tabs idle, then resumes only matching open files without blocking local restoration", async () => {
	const f = setup();
	let finish;
	const response = new Promise((resolve) => {
		finish = resolve;
	});
	f.remote.readFile.mockReturnValue(response);
	await f.restoreFiles([
		{
			id: "pending",
			filename: "pending.js",
			uri: "custom://pending",
			cursorPos: { ranges: [{ from: 5, to: 5 }] },
		},
		{ id: "closed", filename: "closed.js", uri: "custom://closed" },
		{ id: "missing", filename: "missing.js", uri: "disabled://missing" },
		{
			id: "local",
			filename: "local.js",
			uri: "file:///local.js",
			render: true,
		},
		{ id: "http", filename: "remote.js", uri: "https://example/remote.js" },
		{ id: "closing", filename: "closing.js", uri: "custom://closing" },
	]);
	const [pending, closed, missing, local, http, closing] = f.manager.files;
	expect(local.session.doc.toString()).toBe("local content");
	expect(http.loading).toBe(true);
	const firstAttempt = pending.load();
	await firstAttempt;
	expect(pending.load()).not.toBe(firstAttempt); // No promise is waiting for a plugin.
	await pending.load();
	expect(pending.loaded).toBe(false);
	expect(pending.loading).toBe(false);
	await pending.writeToCache();
	expect(await pending.save()).toBe(false);
	expect(await pending.saveAs()).toBe(false);
	expect(f.write).not.toHaveBeenCalled();
	expect(f.selectLocation).not.toHaveBeenCalled();
	await closed.remove(true);
	await vi.advanceTimersByTimeAsync(65000);
	expect(pending.tab).not.toBeNull();
	expect(missing.tab).not.toBeNull();
	f.fs.extend((uri) => uri.startsWith("custom:"), f.remoteFactory);
	f.fs.extend((uri) => uri.startsWith("custom:"), f.remoteFactory);
	await vi.advanceTimersByTimeAsync(0);
	expect(f.remote.readFile).toHaveBeenCalledTimes(3);
	expect(pending.loading).toBe(true);
	const completion = Promise.all([pending.load(), http.load(), closing.load()]);
	await closing.remove(true);
	finish("remote content");
	await completion;
	expect(pending.session.doc.toString()).toBe("remote content");
	expect(pending.session.selection.main.head).toBe(5);
	expect(pending.loading).toBe(false);
	expect(pending.loaded).toBe(true);
	expect(closed.session).toBeNull();
	expect(closing.session).toBeNull();
	expect(http.session.doc.toString()).toBe("remote content");
	expect(f.manager.activeFile).toBe(local);
	expect(missing.loaded).toBe(false);
	expect(missing.loading).toBe(false);
	expect(f.cache.has(pending.cacheFile)).toBe(false);
	expect(f.toast).not.toHaveBeenCalled();
	expect(f.log).not.toHaveBeenCalled();
});

it.each(["cached text", "", undefined])(
	"keeps the loading view for cache %j until the session is ready",
	(cached) => {
		const source = managerSource;
		const body = managerBody;
		const names = [
			"showLoadingEditor",
			"applyFileToEditor",
			"recreateActiveEditorState",
			"getRawEditorState",
			"isReusableEditorState",
		];
		const editor = new EditorView({ parent: document.body });
		const file = {
			type: "editor",
			filename: "file.js",
			loaded: false,
			loading: false,
			session: EditorState.create(),
			__cmSessionReady: true,
			__cmExtensionSignature: "test",
		};
		const loadingPreviews = new WeakMap();
		if (cached !== undefined) loadingPreviews.set(file, cached);
		const context = vm.createContext({
			editor,
			EditorState,
			placeholder,
			createEditorReadOnlyExtension,
			blurEditorIfReadOnly,
			loadingPreviews,
			manager: { activeFile: file },
			touchSelectionController: null,
			themeCompartment: new Compartment(),
			languageCompartment: new Compartment(),
			lspCompartment: new Compartment(),
			readOnlyCompartment: new Compartment(),
			getConfiguredThemeExtension: () => [],
			getBaseExtensionsFromOptions: () => [],
			getEditorExtensionSignature: () => "test",
			getFileLanguageSignature: () => "text",
			applyCurrentEditorOptions: vi.fn(),
			shouldApplyLanguage: () => false,
			restoreFileScrollPosition: vi.fn(),
			scheduleLspForFile: vi.fn(),
		});
		// Run the actual render functions with a real EditorView; omit the unrelated app shell.
		vm.runInContext(
			body
				.filter(
					(node) =>
						node.type === "FunctionDeclaration" && names.includes(node.id.name),
				)
				.map((node) => source.slice(node.start, node.end))
				.join("\n"),
			context,
		);
		try {
			const savedSession = file.session;
			context.applyFileToEditor(file);
			const preview = editor.state;
			context.recreateActiveEditorState();
			expect(editor.state).toBe(preview);
			context.applyFileToEditor(file, { forceRecreate: true });
			expect(editor.state.doc.toString()).toBe(cached ?? "");
			expect(editor.state.readOnly).toBe(true);
			expect(editor.contentDOM.getAttribute("contenteditable")).toBe("false");
			expect(
				editor.dom.querySelector(".cm-placeholder")?.textContent ?? null,
			).toBe(cached === undefined ? "Loading file.js..." : null);
			expect(file.session).toBe(savedSession);
			file.session = EditorState.create({ doc: cached ?? "loaded text" });
			file.loaded = true;
			file.loading = false;
			context.applyFileToEditor(file);
			expect(editor.state).toBe(file.session);
			expect(editor.state.readOnly).toBe(false);
			expect(editor.dom.querySelector(".cm-placeholder")).toBeNull();
		} finally {
			editor.destroy();
		}
	},
);

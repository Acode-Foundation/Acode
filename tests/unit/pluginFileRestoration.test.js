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

it("waits for the provider without blocking local files, losing recovery data, or reviving closed tabs", async () => {
	vi.useFakeTimers();
	let finishPluginLoad;
	const ready = new Promise((resolve) => {
		finishPluginLoad = resolve;
	});
	let registered = false;
	const cache = new Map([
		["file:///local.js", "local content"],
		["file:///cache/repo", "unsaved edit"],
	]);
	const write = vi.fn();
	const remote = {
		exists: async () => true,
		stat: async () => ({}),
		readFile: vi.fn(async () => "remote content"),
	};
	const fs = (uri) =>
		uri.startsWith("gh:")
			? registered
				? remote
				: undefined
			: {
					exists: async () => cache.has(uri),
					readFile: async () => cache.get(uri),
					stat: async () => ({}),
					writeFile: write,
					createFile: write,
					delete: async () => cache.delete(uri),
					lsDir: async () => [{ url: "file:///plugins/github" }],
				};
	fs.hasProvider = (uri) => !uri.startsWith("gh:") || registered;
	const url = {
		join: (...parts) => parts.join("/"),
		basename: (value) => value.split("/").at(-1),
		getProtocol: (value) => `${value.split(":")[0]}:`,
	};
	const settings = { value: {}, on: vi.fn(), off: vi.fn() };
	const acode = {};
	const plugins = loadSourceModule(
		"src/lib/loadPlugins.js",
		{
			"../fileSystem": fs,
			"../utils/Url": url,
			"./settings": settings,
			"./loadPlugin": async () => {
				await ready;
				registered = true;
			},
		},
		{
			acode,
			PLUGIN_DIR: "file:///plugins",
			window: { log: vi.fn() },
			toast: vi.fn(),
			strings: {},
		},
	);
	acode[plugins.onPluginLoadCallback] = vi.fn();
	acode[plugins.onPluginsLoadCompleteCallback] = vi.fn();
	const manager = {
		files: [],
		activeFile: null,
		header: {},
		emit: vi.fn(),
		onupdate: vi.fn(),
		getFile: (id) => manager.files.find((file) => file.id === id),
		addFile: (file) => manager.files.push(file),
	};
	const toast = vi.fn();
	const log = vi.fn();
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
			fileSystem: fs,
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
			"utils/helpers": {
				normalizeMtime: () => null,
				getStatMtime: () => null,
				getIconForFile: () => "file",
				getVirtualPath: (value) => value,
			},
			"./config": { DEFAULT_FILE_SESSION: "default" },
			"./loadPlugins": plugins,
			"./settings": settings,
			"./saveFile": vi.fn(),
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
		{ fileSystem: fs, "./editorFile": EditorFile },
	);

	await restoreFiles([
		{
			id: "repo",
			filename: "repo.js",
			uri: "gh://repo/example@main/repo.js",
			isUnsaved: true,
			cursorPos: { ranges: [{ from: 5, to: 5 }] },
		},
		{ id: "closed", filename: "closed.js", uri: "gh://gist/123/closed.js" },
		{
			id: "local",
			filename: "local.js",
			uri: "file:///local.js",
			render: true,
		},
	]);
	const [repo, closed, local] = manager.files;
	expect(log.mock.calls).toEqual([]);
	expect(local.session.doc.toString()).toBe("local content");
	expect(repo.loaded).toBe(false);
	expect(manager.emit).toHaveBeenCalledWith(
		"file-loading-preview",
		repo,
		"unsaved edit",
	);
	expect(remote.readFile).not.toHaveBeenCalled();
	await repo.writeToCache();
	expect(write).not.toHaveBeenCalled();
	const closedLoad = closed.load();
	await closed.remove(true);
	const loading = plugins.default();
	finishPluginLoad();
	await loading;
	await Promise.all([repo.load(), closedLoad]);
	expect(repo.session.doc.toString()).toBe("unsaved edit");
	expect(repo.session.selection.main.head).toBe(5);
	expect(repo.isUnsaved).toBe(true);
	expect(cache.get("file:///cache/repo")).toBe("unsaved edit");
	expect(closed.session).toBeNull();
	expect(remote.readFile).toHaveBeenCalledOnce();
	expect(manager.activeFile).toBe(local);
	expect(toast).not.toHaveBeenCalled();
});

it.each(["cached text", "", undefined])(
	"keeps the loading view for cache %j until the session is ready",
	(cached) => {
		const source = readFileSync("src/lib/editorManager.js", "utf8");
		const body = parse(source, {
			sourceType: "module",
			plugins: ["jsx"],
		}).program.body.find(
			(node) =>
				node.type === "FunctionDeclaration" && node.id.name === "EditorManager",
		).body.body;
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
			loading: true,
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

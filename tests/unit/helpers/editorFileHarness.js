import { EditorSelection, EditorState } from "@codemirror/state";
import tag from "html-tag-js";
import { vi } from "vitest";
import { loadSourceModule } from "../../helpers/loadSourceModule";

export default function setupEditorFile({
	filename = "Original.ts",
	uri = "content://provider/original-document",
	SAFMode = "single",
} = {}) {
	const manager = {
		files: [],
		activeFile: null,
		header: {},
		TIMEOUT_VALUE: 0,
		addFile: (file) => manager.files.push(file),
		getFile: (id, key = "id") => manager.files.find((file) => file[key] === id),
		emit: vi.fn(),
		onupdate: vi.fn(),
	};
	const settings = {
		value: {
			defaultFileEncoding: "utf-8",
			openFileListPos: "sidebar",
			floatingButton: false,
		},
		OPEN_FILE_LIST_POS_HEADER: "header",
		OPEN_FILE_LIST_POS_BOTTOM: "bottom",
		on: vi.fn(),
		off: vi.fn(),
	};
	const helpers = {
		fixFilename: (name) => name,
		getIconForFile: () => "file",
		getVirtualPath: (value) => value,
		normalizeMtime: (value) => value ?? null,
		uuid: () => "generated-editor-id",
	};
	const fsOperation = vi.fn(() => ({
		exists: vi.fn(async () => false),
		renameTo: vi.fn(),
	}));
	const url = {
		join: (...parts) => parts.join("/"),
		dirname: (value) => value.slice(0, value.lastIndexOf("/")),
		extname: (value) => {
			const name = value.split(/[/?#]/).pop();
			const index = name.lastIndexOf(".");
			return index < 0 ? "" : name.slice(index);
		},
		getProtocol: (value) => `${value.split(":")[0]}:`,
	};
	const tile = ({ text }) => {
		const element = document.createElement("li");
		element.innerHTML = '<span class="text"></span>';
		let value = text;
		Object.defineProperty(element, "text", {
			get: () => value,
			set(next) {
				value = next;
				element.querySelector(".text").textContent = next;
			},
		});
		element.tail = vi.fn();
		return element;
	};
	const dependencies = {
		fileSystem: fsOperation,
		"@codemirror/state": { EditorSelection, EditorState },
		"cm/editorReadOnly": {},
		"cm/editorUtils": {
			clearSelection: vi.fn(),
			getDocText: (doc) => doc.toString(),
		},
		"cm/modelist": { getMode: vi.fn(), getModeForPath: vi.fn() },
		"components/quickTools": { $toggler: document.createElement("button") },
		"components/sidebar": { hide: vi.fn() },
		"components/tile": tile,
		"components/toast": vi.fn(),
		"dialogs/confirm": vi.fn(),
		dompurify: { sanitize: (value) => value },
		"handlers/editorFileTab": vi.fn(),
		"handlers/quickTools": vi.fn(),
		"handlers/tabContextMenu": { openTabContextMenuOnRelease: vi.fn() },
		"html-tag-js": tag,
		"lib/quickToolsAdapter": { visible: () => false },
		"mime-types": { lookup: () => "text/plain" },
		"utils/codeHighlight": { applyHighlightStyles: vi.fn() },
		"utils/helpers": helpers,
		"utils/Path": {},
		"utils/remoteFilePreview": { readRemoteFilePreview: vi.fn() },
		"utils/Url": url,
		"./config": {
			DEFAULT_FILE_NAME: "Untitled",
			DEFAULT_FILE_SESSION: "default",
			VIBRATION_TIME: 0,
		},
		"./loadPlugins": { isInitialPluginLoadComplete: () => false },
		"./openFolder": { find: vi.fn() },
		"./run": vi.fn(),
		"./saveFile": vi.fn(),
		"./settings": settings,
	};
	const { default: EditorFile } = loadSourceModule(
		"src/lib/editorFile.js",
		dependencies,
		{
			document,
			window,
			tag,
			editorManager: manager,
			CACHE_STORAGE: "file:///cache",
			strings: { "new file": "New file" },
		},
		`String.prototype.hashCode = function () { let hash = 0; for (let i = 0; i < this.length; i++) hash = (hash << 5) - hash + this.charCodeAt(i) | 0; return hash; };`,
	);
	EditorFile.prototype.render = function () {
		manager.activeFile = this;
	};
	EditorFile.prototype.setMode = vi.fn();
	EditorFile.prototype.scheduleCacheWrite = vi.fn(async () => {});

	const file = new EditorFile(filename, {
		id: "original-file-id",
		uri,
		SAFMode,
		type: "editor",
		text: "original contents",
		isUnsaved: true,
		docVersion: 1,
		render: true,
	});
	file.markSaved = vi.fn();

	return { EditorFile, file, manager, fsOperation };
}

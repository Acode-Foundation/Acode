// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => {
	const settings = {
		value: {
			rememberFiles: true,
			rememberFolders: false,
		},
	};

	return {
		settings,
		openFile: vi.fn(),
	};
});

vi.mock("cm/editorUtils", () => ({
	getAllFolds: vi.fn(() => []),
	getScrollPosition: vi.fn(() => ({ scrollTop: 0, scrollLeft: 0 })),
	getSelection: vi.fn(() => ({
		ranges: [{ from: 0, to: 0 }],
		mainIndex: 0,
	})),
}));
vi.mock("dialogs/alert", () => ({ default: vi.fn() }));
vi.mock("fileSystem", () => ({ default: vi.fn() }));
vi.mock("lib/auth", () => ({ default: {} }));
vi.mock("lib/config", () => ({
	default: { DEFAULT_FILE_SESSION: "default-session" },
}));
vi.mock("lib/openFile", () => ({ default: runtime.openFile }));
vi.mock("lib/openFolder", () => ({
	default: vi.fn(),
	addedFolder: [],
}));
vi.mock("lib/settings", () => ({ default: runtime.settings }));
vi.mock("lib/startAd", () => ({
	BANNER_SUPPRESSION_REASON: {},
	setBannerSuppressed: vi.fn(),
}));
vi.mock("utils/helpers", () => ({
	default: { error: vi.fn(), errorMessage: vi.fn() },
}));

import HandleIntent from "handlers/intent";
import { promoteSessionPersistence } from "lib/fileSessionPersistence";
import saveState from "lib/saveState";
import FileBrowser from "pages/fileBrowser";

describe("file session persistence", () => {
	beforeEach(() => {
		runtime.openFile.mockReset();
		localStorage.clear();
		sessionStorage.clear();
		sessionStorage.setItem("isfilesRestored", "true");
		globalThis.editorManager = {
			editor: {},
			files: [],
			activeFile: null,
			getFile(value, type = "id") {
				return this.files.find((file) => file[type] === value);
			},
		};
		runtime.openFile.mockImplementation(async (uri, options = {}) => {
			const existingFile = globalThis.editorManager.getFile(uri, "uri");
			if (existingFile) {
				promoteSessionPersistence(existingFile, options.persistInSession);
				globalThis.editorManager.activeFile = existingFile;
				return;
			}

			const file = createOpenFile(uri, options);
			globalThis.editorManager.files.push(file);
			globalThis.editorManager.activeFile = file;
		});
	});

	it("persists only a picker document with durable URI access", async () => {
		const selectedUri = "content://documents/document/selected";
		const unpersistableUri = "content://documents/document/no-grant";
		const intentUri = "content://external-app/shared/temporary";

		await FileBrowser.openFile({
			type: "file",
			url: selectedUri,
			name: "selected.js",
			mode: "single",
			persistedUriPermission: true,
		});
		await FileBrowser.openFile({
			type: "file",
			url: unpersistableUri,
			name: "no-grant.js",
			mode: "single",
			persistedUriPermission: false,
		});
		await HandleIntent({
			action: "android.intent.action.VIEW",
			data: intentUri,
		});
		await HandleIntent({
			action: "android.intent.action.VIEW",
			data: selectedUri,
		});

		saveState();

		const restoredUris = JSON.parse(localStorage.files).map(
			(file) => file.uri,
		);
		expect(restoredUris).toEqual([selectedUri]);
	});

	it("promotes an intent tab when the same document is later selected", async () => {
		const uri = "content://documents/document/shared";

		await HandleIntent({
			action: "android.intent.action.VIEW",
			data: uri,
		});
		await FileBrowser.openFile({
			type: "file",
			url: uri,
			name: "shared.js",
			mode: "single",
			persistedUriPermission: true,
		});

		saveState();

		expect(JSON.parse(localStorage.files).map((file) => file.uri)).toEqual([
			uri,
		]);
	});
});

function createOpenFile(uri, options) {
	return {
		id: `file-${globalThis.editorManager.files.length + 1}`,
		uri,
		type: "editor",
		filename: options.name || uri.split("/").pop(),
		pinned: false,
		isUnsaved: false,
		docVersion: 0,
		savedVersion: 0,
		cacheVersion: 0,
		savedMtime: 1,
		diskMtime: 1,
		hasDiskConflict: false,
		readOnly: false,
		SAFMode: options.mode,
		deletedFile: false,
		session: {
			selection: { ranges: [{ from: 0, to: 0 }], mainIndex: 0 },
		},
		lastScrollTop: 0,
		lastScrollLeft: 0,
		editable: true,
		encoding: "UTF-8",
		persistInSession: options.persistInSession,
	};
}

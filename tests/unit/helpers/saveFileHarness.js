import { vi } from "vitest";
import { loadSourceModule } from "../../helpers/loadSourceModule";

export default function setupSaveFile(selectedOption = "select-folder") {
	const uri =
		"content://com.android.externalstorage.documents/document/primary%3ANew.ts";
	const deviceFile = {
		writeFile: vi.fn(async () => "OK"),
		stat: vi.fn(async () => ({ modifiedDate: 123 })),
	};
	const fsOperation = vi.fn(() => deviceFile);
	const externalFs = {
		createDocument: vi.fn(async () => ({
			uri,
			filename: "New.ts",
			persistedUriPermission: true,
		})),
	};
	const recents = {
		select: vi.fn(async () => selectedOption),
		addFile: vi.fn(),
		addFolder: vi.fn(),
	};
	const fileBrowser = vi.fn(async (_mode, _info, _doesOpenLast, options) => {
		const createdDocument = await externalFs.createDocument(
			options.createDocument.mimeType,
			options.createDocument.filename,
		);
		return {
			...createdDocument,
			type: "file",
			url: createdDocument.uri,
			name: createdDocument.filename,
			mode: "single",
		};
	});
	const editorManager = {
		TIMEOUT_VALUE: 0,
		activeFile: null,
		getFile: vi.fn(() => null),
		onupdate: vi.fn(),
		emit: vi.fn(),
	};
	const helpers = {
		fixFilename: (name) => name,
		getStatMtime: (stat) => stat?.modifiedDate ?? null,
		error: vi.fn(),
	};
	const documentDependencies = {
		fileSystem: Object.assign(fsOperation, { hasProvider: () => true }),
		"fileSystem/externalFs": externalFs,
		"@codemirror/state": {},
		"cm/editorUtils": { getDocText: () => "new file contents" },
		"components/toast": vi.fn(),
		"dialogs/confirm": vi.fn(),
		"dialogs/prompt": vi.fn(),
		"dialogs/select": vi.fn(),
		"lib/recents": recents,
		"pages/fileBrowser": fileBrowser,
		"utils/helpers": helpers,
		"utils/Url": {},
		"./config": {},
		"./editorFile": {},
		"./openFolder": { find: vi.fn() },
		"./settings": { value: { formatOnSave: false } },
		"mime-types": { lookup: vi.fn(() => "text/typescript") },
	};
	const { default: saveFile } = loadSourceModule(
		"src/lib/saveFile.js",
		documentDependencies,
		{
			editorManager,
			strings: {
				"create document on device": "Create document on device",
				"save file": "Save file",
				"select folder": "Select folder",
				saving: "Saving",
				"new file": "New file",
			},
			sdcard: { createDocument: vi.fn() },
		},
	);
	const tab = {
		querySelector: vi.fn(() => ({ textContent: "" })),
	};
	const file = {
		loaded: true,
		loading: false,
		tab,
		uri: null,
		filename: "Untitled.ts",
		isSaving: false,
		encoding: "utf-8",
		SAFMode: null,
		persistInSession: true,
		readOnly: false,
		docVersion: 1,
		session: { doc: {} },
		location: null,
		markSaved: vi.fn(),
	};

	return { saveFile, file, deviceFile, externalFs, recents, fileBrowser, uri };
}

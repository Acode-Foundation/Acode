import { getAllFolds, getScrollPosition, getSelection } from "cm/editorUtils";
import constants from "./constants";
import { addedFolder } from "./openFolder";
import appSettings from "./settings";

export default () => {
	if (!window.editorManager) return;

	const filesToSave = [];
	const folders = [];
	const { editor, files, activeFile } = editorManager;
	const { value: settings } = appSettings;

	files.forEach((file) => {
		if (file.type !== "editor") return;
		if (file.id === constants.DEFAULT_FILE_SESSION) return;
		if (file.SAFMode === "single") return;

		// Selection per file:
		// - Active file uses live EditorView selection
		// - Inactive files use their persisted EditorState selection
		let cursorPos;
		if (activeFile?.id === file.id) {
			cursorPos = getSelection(editor);
		} else {
			const sel = file.session?.selection;
			if (sel) {
				cursorPos = {
					ranges: sel.ranges.map((r) => ({ from: r.from, to: r.to })),
					mainIndex: sel.mainIndex ?? 0,
				};
			} else {
				cursorPos = null;
			}
		}

		// Scroll per file:
		// - Active file uses live scroll from EditorView
		// - Inactive files use lastScrollTop/Left captured on tab switch
		let scrollTop, scrollLeft;
		if (activeFile?.id === file.id) {
			const sp = getScrollPosition(editor);
			scrollTop = sp.scrollTop;
			scrollLeft = sp.scrollLeft;
		} else {
			scrollTop =
				typeof file.lastScrollTop === "number" ? file.lastScrollTop : 0;
			scrollLeft =
				typeof file.lastScrollLeft === "number" ? file.lastScrollLeft : 0;
		}

		const fileJson = {
			id: file.id,
			uri: file.uri,
			type: file.type,
			filename: file.filename,
			isUnsaved: file.isUnsaved,
			readOnly: file.readOnly,
			SAFMode: file.SAFMode,
			deletedFile: file.deletedFile,
			cursorPos,
			scrollTop,
			scrollLeft,
			editable: file.editable,
			encoding: file.encoding,
			render: activeFile?.id === file.id,
			folds: getAllFolds(file.session),
		};

		if (settings.rememberFiles || fileJson.isUnsaved)
			filesToSave.push(fileJson);
	});

	if (settings.rememberFolders) {
		addedFolder.forEach((folder) => {
			const { url, saveState, title, listState, listFiles } = folder;
			folders.push({
				url,
				opts: {
					saveState,
					name: title,
					listState,
					listFiles,
				},
			});
		});
	}

	localStorage.files = JSON.stringify(filesToSave);
	localStorage.folders = JSON.stringify(folders);
};

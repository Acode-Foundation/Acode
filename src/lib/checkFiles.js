import fsOperation from "fileSystem";
import alert from "dialogs/alert";
import confirm from "dialogs/confirm";

let checkFileEnabled = true;

Object.defineProperty(checkFiles, "check", {
	set(value) {
		checkFileEnabled = value;
	},
	get() {
		return checkFileEnabled;
	},
});

export default async function checkFiles() {
	if (!editorManager) return;
	if (checkFileEnabled === false) {
		checkFileEnabled = true;
		return;
	}
	const files = editorManager.files;
	const { editor } = editorManager;

	recursiveFileCheck([...files]);

	/**
	 * Checks if the file has been changed
	 * @param {EditorFile[]} files List of files to check
	 */
	async function recursiveFileCheck(files) {
		const file = files.pop();
		await checkFile(file);
		if (files.length) {
			recursiveFileCheck(files);
		}
		return;
	}

	/**
	 * @typedef {import('./editorFile').default} EditorFile
	 */

	/**
	 * Checks a file for changes
	 * @param {EditorFile} file File to check
	 * @returns {Promise<void>}
	 */
	async function checkFile(file) {
		if (file === undefined || file.isUnsaved || !file.loaded || file.loading)
			return;

		if (file.uri) {
			const fs = fsOperation(file.uri);
			const exists = await fs.exists();

			if (!exists && !file.readOnly) {
				file.isUnsaved = true;
				file.uri = null;
				editorManager.onupdate("file-changed");
				editorManager.emit("update", "file-changed");
				await new Promise((resolve) => {
					alert(
						strings.info,
						strings["file has been deleted"].replace("{file}", file.filename),
						resolve,
					);
				});
				return;
			}

			const text = await fs.readFile(file.encoding);
			const loadedText = file.session.getValue();

			if (text !== loadedText) {
				try {
					const confirmation = await confirm(
						strings.warning.toUpperCase(),
						file.filename + strings["file changed"],
					);

					if (!confirmation) return;

					const cursorPos = editor.getCursorPosition();
					editorManager.getFile(file.id, "id")?.makeActive();

					file.markChanged = false;
					file.session.setValue(text);
					editor.gotoLine(cursorPos.row, cursorPos.column);
					editor.renderer.scrollCursorIntoView(cursorPos, 0.5);
				} catch (error) {
					// ignore
				}
			}
		}
	}

	if (!editorManager.activeFile) {
		app.focus();
	}
}

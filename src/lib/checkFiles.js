import fsOperation from "fileSystem";
import { Text } from "@codemirror/state";
import alert from "dialogs/alert";
import confirm from "dialogs/confirm";
import helpers from "utils/helpers";

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
	// @ts-check
	/** @type {{ editor: import('@codemirror/view').EditorView }} */
	const { editor } = editorManager;

	for (const file of [...files].reverse()) {
		try {
			await checkFile(file);
		} catch (error) {
			console.warn("Failed to check file", error);
		}
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
		if (file?.type !== "editor" || !file.tab || !file.loaded || file.loading)
			return;

		if (file.uri) {
			const fs = fsOperation(file.uri);
			if (!fs) return;
			const exists = fs.exists ? await fs.exists() : true;
			if (!file.tab) return;

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

			let mtime = null;
			if (file.hasVersionMetadata && file.savedMtime != null) {
				const stat = await fs.stat?.().catch(() => null);
				if (!file.tab) return;
				mtime = helpers.getStatMtime(stat);
				if (mtime != null) {
					if (mtime === file.savedMtime) return;
					const alreadyWarnedConflict =
						file.hasDiskConflict && file.diskMtime === mtime;
					file.markDiskChanged({ mtime });
					if (file.hasDiskConflict) {
						editorManager.onupdate("file-changed");
						editorManager.emit("update", "file-changed");
						console.warn(
							`File changed on disk while unsaved: ${file.filename}`,
						);
						if (!alreadyWarnedConflict) {
							await new Promise((resolve) => {
								alert(
									strings.warning,
									`${file.filename} changed on disk while you have unsaved edits. Saving now may overwrite the external changes.`,
									resolve,
								);
							});
						}
						return;
					}
				}
			}

			if (file.isUnsaved) return;

			// Read the file before deciding anything. If the read fails, say so
			// and stop: a failed read is not a changed file, and offering to
			// reload would replace the document with whatever the failure
			// produced. That is how a dropped connection once blanked a file.
			let text;
			try {
				text = await fs.readFile(file.encoding);
			} catch (error) {
				if (!file.tab) return;
				window.log("error", error);
				if (file.hasVersionMetadata && !file.readOnly) {
					await new Promise((resolve) => {
						alert(
							strings.warning,
							strings["file could not be read"].replace(
								"{file}",
								file.filename,
							),
							resolve,
						);
					});
				}
				return;
			}
			if (!file.tab) return;
			if (text == null) return;

			const diskDoc = Text.of(String(text ?? "").split("\n"));
			const currentDoc = file.session?.doc;

			if (!currentDoc?.eq?.(diskDoc)) {
				try {
					// Never replace a document with an empty read: an empty result
					// for a file that has content is a failed read, not an edit.
					if (
						diskDoc.length <= 1 &&
						String(text ?? "").length === 0 &&
						(currentDoc?.length ?? 0) > 1
					) {
						return;
					}

					const confirmation = await confirm(
						strings.warning,
						file.filename + strings["file changed"],
					);

					if (!confirmation || !file.tab) return;

					// Reloading replaces the document with the disk version. Write the
					// current buffer to the recovery cache first, so the text being
					// discarded survives even if the replacement is unwanted.
					try {
						await file.flushCacheWrite();
					} catch (error) {
						console.warn("Could not preserve a copy before reloading", error);
					}

					const cursorPos = editor.getCursorPosition();
					editorManager.getFile(file.id, "id")?.makeActive();

					file.markChanged = false;
					try {
						file.session.setValue(text);
						file.markLoaded({ mtime });
					} finally {
						file.markChanged = true;
					}
					await file.flushCacheWrite();
					editor.gotoLine(cursorPos.row, cursorPos.column);
				} catch (error) {
					// ignore
				}
			} else if (mtime != null && file.hasVersionMetadata) {
				file.markLoaded({ mtime });
			}
		}
	}

	if (!editorManager.activeFile) {
		app.focus();
	}
}

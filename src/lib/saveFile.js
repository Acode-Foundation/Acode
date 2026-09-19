import fsOperation, { hasProvider } from "fileSystem";
import { Text } from "@codemirror/state";
import { getDocText } from "cm/editorUtils";
import toast from "components/toast";
import confirm from "dialogs/confirm";
import prompt from "dialogs/prompt";
import select from "dialogs/select";
import recents from "lib/recents";
import FileBrowser from "pages/fileBrowser";
import helpers from "utils/helpers";
import Url from "utils/Url";
import config from "./config";
import EditorFile from "./editorFile";
import openFolder from "./openFolder";
import appSettings from "./settings";

let saveTimeout;

const SELECT_FOLDER = "select-folder";

/**
 * Saves a file to it's location, if file is new, it will ask for location
 * @param {EditorFile} file
 * @param {boolean} [isSaveAs]
 * @param {{automatic?: boolean, savedDoc?: import('@codemirror/state').Text}} [options] Internal save context.
 * @returns {Promise<boolean>}
 */
async function saveFile(
	file,
	isSaveAs = false,
	{ automatic = false, savedDoc: baseline = null } = {},
) {
	// If file is loading, return
	if (!file.loaded || file.loading || !file.tab) return false;
	if (!isSaveAs && file.uri && !hasProvider(file.uri)) {
		if (!automatic)
			toast(
				strings["file provider unavailable"] || "File provider unavailable",
			);
		return false;
	}
	const tab = file.tab;
	let targetUri = file.uri;
	const isCurrent = () => file.tab === tab && file.uri === targetUri;

	/**
	 * If set, new file needs to be created
	 * @type {string}
	 */
	let newUrl;
	/**
	 * File operation object
	 * @type {fsOperation}
	 */
	let fileOnDevice;
	/**
	 * File name, can be changed by user
	 * @type {string}
	 */
	let { filename } = file;
	/**
	 * If file is new
	 * @type {boolean}
	 */
	let isNewFile = false;

	/**
	 * Encoding of file
	 * @type {string}
	 */
	const { encoding } = file;
	/**
	 * File tab bar text element, used to show saving status
	 * @type {HTMLElement}
	 */
	const $text = file.tab.querySelector("span.text");

	if (!file.uri) {
		isNewFile = true;
	} else {
		isSaveAs = isSaveAs ?? file.readOnly;
	}

	if (isSaveAs || isNewFile) {
		const option = await recents.select(
			[[SELECT_FOLDER, strings["select folder"], "folder"]], // options
			"dir", // type
			strings["select folder"], // title
		);
		if (!option || !isCurrent()) return false;

		if (option === SELECT_FOLDER) {
			newUrl = await selectFolder();
		} else {
			newUrl = option.val.url;
		}
		if (!newUrl || !isCurrent()) return false;

		if (isSaveAs) {
			filename = await getfilename(newUrl, file.filename);
		} else {
			filename = await check(newUrl, file.filename);
		}

		// in case if user cancels the dialog
		if (!filename || !isCurrent()) {
			return false;
		}
	}

	if (filename !== file.filename) {
		file.filename = filename;
	}

	$text.textContent = strings.saving + "...";
	file.isSaving = true;
	let saved = false;

	try {
		if (appSettings.value.formatOnSave) {
			// Format the in-memory content BEFORE creating/reassigning the
			// save target below: a failed format aborts the save before any
			// file creation, URI reassignment, or recents update happens.
			// Formatters operate on the active editor document. If the user
			// switched tabs while an async save step was pending, formatting
			// here would rewrite the wrong file, so only format when the file
			// being saved is the active one.
			file.markChanged = false;
			try {
				if (editorManager.activeFile === file) {
					// Await the formatter so the write below captures the
					// formatted document. A failed format aborts the save;
					// `null` means no formatter is configured, which is not
					// a failure.
					const formatted = await acode.exec("format", false);
					if (formatted === false) return false;
				}
			} finally {
				file.markChanged = true;
			}
		}

		if (isSaveAs || newUrl) {
			// if save as or new file
			const fileUri = Url.join(newUrl, file.filename);
			fileOnDevice = fsOperation(fileUri);

			const exists = await fileOnDevice.exists();
			if (!isCurrent()) return false;
			if (!exists) {
				await fsOperation(newUrl).createFile(file.filename);
			}
			if (!isCurrent()) return false;

			const openedFile = editorManager.getFile(fileUri, "uri");
			if (openedFile) openedFile.uri = null;
			file.uri = fileUri;
			targetUri = fileUri;
			recents.addFile(fileUri);

			const folder = openFolder.find(newUrl);
			if (folder) folder.reload();
		}

		if (!fileOnDevice) {
			fileOnDevice = fsOperation(file.uri);
		}
		if (!fileOnDevice || !isCurrent()) return false;

		if (!isSaveAs && !isNewFile) {
			const source = Text.of(
				(await fileOnDevice.readFile(encoding)).split(/\r\n?|\n/),
			);
			if (!isCurrent()) return false;
			let unchanged = source.eq(file.session.doc);
			if (!unchanged && baseline) {
				unchanged = source.eq(baseline);
			} else if (!unchanged && file.savedMtime != null) {
				const stat = await fileOnDevice.stat?.().catch(() => null);
				if (!isCurrent()) return false;
				unchanged = helpers.getStatMtime(stat) === file.savedMtime;
			}
			if (!unchanged) {
				file.hasDiskConflict = true;
				file.refreshUnsavedState();
				editorManager.onupdate("file-changed");
				editorManager.emit("update", "file-changed");
				if (automatic) return false;
				const overwrite = await confirm(
					strings.warning || "Warning",
					`${file.filename}: the source has changed or its saved version could not be verified. Overwrite it with this document?`,
				);
				if (!overwrite || !isCurrent()) return false;
			}
		}

		const savedDoc = file.session?.doc || null;
		const savedVersion = file.docVersion;
		const data = getDocText(savedDoc);
		if (!isCurrent()) return false;

		await fileOnDevice.writeFile(data, encoding);
		if (!isCurrent()) return false;
		const stat = await fileOnDevice.stat?.().catch(() => null);
		if (!isCurrent()) return false;
		file.markSaved({
			mtime: helpers.getStatMtime(stat),
			savedDoc,
			savedVersion,
		});
		saved = true;

		if (file.location) {
			recents.addFolder(file.location);
		}

		clearTimeout(saveTimeout);
		saveTimeout = setTimeout(() => {
			if (!isCurrent()) return;
			file.isSaving = false;
			if (newUrl) recents.addFile(file.uri);
			editorManager.onupdate("save-file");
			editorManager.emit("update", "save-file");
			editorManager.emit("save-file", file);
			resetText();
		}, editorManager.TIMEOUT_VALUE + 100);
		return true;
	} catch (err) {
		if (!automatic && isCurrent()) helpers.error(err);
		return false;
	} finally {
		if (isCurrent()) {
			if (!saved) file.isSaving = false;
			resetText();
		}
	}

	function resetText() {
		setTimeout(() => {
			if (isCurrent()) $text.textContent = file.filename;
		}, editorManager.TIMEOUT_VALUE);
	}

	async function selectFolder() {
		const dir = await FileBrowser(
			"folder",
			strings[`save file${isSaveAs ? " as" : ""}`],
		);
		return dir.url;
	}

	async function getfilename(url, name) {
		let filename = await prompt(
			strings["enter file name"],
			name || "",
			strings["new file"],
			{
				match: config.FILE_NAME_REGEX,
				required: true,
			},
		);

		filename = helpers.fixFilename(filename);
		if (!filename) return null;
		return await check(url, filename);
	}

	async function check(url, filename) {
		const pathname = Url.join(url, filename);

		const fs = fsOperation(pathname);
		if (!(await fs.exists())) return filename;

		const action = await select(strings["file already exists"], [
			["overwrite", strings.overwrite],
			["newname", strings["enter file name"]],
		]);

		if (action === "newname") {
			filename = await getfilename(url, filename);
		}

		return filename;
	}
}

export default saveFile;

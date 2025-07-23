import fsOperation from "fileSystem";
import prompt from "dialogs/prompt";
import select from "dialogs/select";
import recents from "lib/recents";
import FileBrowser from "pages/fileBrowser";
import helpers from "utils/helpers";
import Url from "utils/Url";
import constants from "./constants";
import EditorFile from "./editorFile";
import openFolder from "./openFolder";
import appSettings from "./settings";

let saveTimeout;

const SELECT_FOLDER = "select-folder";

/**
 * Saves a file to it's location, if file is new, it will ask for location
 * @param {EditorFile} file
 * @param {boolean} [isSaveAs]
 */
async function saveFile(file, isSaveAs = false) {
	// If file is loading, return
	if (file.loading) return;

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
	 * File data
	 * @type {string}
	 */
	const data = file.session.getValue();
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

		if (option === SELECT_FOLDER) {
			newUrl = await selectFolder();
		} else {
			newUrl = option.val.url;
		}

		if (isSaveAs) {
			filename = await getfilename(newUrl, file.filename);
		} else {
			filename = await check(newUrl, file.filename);
		}

		// in case if user cancels the dialog
		if (!filename) return;
	}

	if (filename !== file.filename) {
		file.filename = filename;
	}

	$text.textContent = strings.saving + "...";
	file.isSaving = true;

	try {
		if (isSaveAs || newUrl) {
			// if save as or new file
			const fileUri = Url.join(newUrl, file.filename);
			fileOnDevice = fsOperation(fileUri);

			if (!(await fileOnDevice.exists())) {
				await fsOperation(newUrl).createFile(file.filename);
			}

			const openedFile = editorManager.getFile(fileUri, "uri");
			if (openedFile) openedFile.uri = null;
			file.uri = fileUri;
			recents.addFile(fileUri);

			const folder = openFolder.find(newUrl);
			if (folder) folder.reload();
		}

		if (!fileOnDevice) {
			fileOnDevice = fsOperation(file.uri);
		}

		if (appSettings.value.formatOnSave) {
			editorManager.activeFile.markChanged = false;
			acode.exec("format", false);
		}

		await fileOnDevice.writeFile(data, encoding);

		if (file.location) {
			recents.addFolder(file.location);
		}

		clearTimeout(saveTimeout);
		saveTimeout = setTimeout(() => {
			file.isSaving = false;
			file.isUnsaved = false;
			if (newUrl) recents.addFile(file.uri);
			editorManager.onupdate("save-file");
			editorManager.emit("update", "save-file");
			editorManager.emit("save-file", file);
			resetText();
		}, editorManager.TIMEOUT_VALUE + 100);
	} catch (err) {
		helpers.error(err);
	}
	resetText();

	function resetText() {
		setTimeout(() => {
			$text.textContent = file.filename;
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
				match: constants.FILE_NAME_REGEX,
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

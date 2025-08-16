import fsOperation from "fileSystem";
import Sidebar from "components/sidebar";
import { TerminalManager } from "components/terminal";
import color from "dialogs/color";
import confirm from "dialogs/confirm";
import prompt from "dialogs/prompt";
import select from "dialogs/select";
import actions from "handlers/quickTools";
import recents from "lib/recents";
import FileBrowser from "pages/fileBrowser";
import plugins from "pages/plugins";
import Problems from "pages/problems/problems";
import changeEncoding from "palettes/changeEncoding";
import changeMode from "palettes/changeMode";
import changeTheme from "palettes/changeTheme";
import commandPalette from "palettes/commandPalette";
import findFile from "palettes/findFile";
import browser from "plugins/browser";
import help from "settings/helpSettings";
import mainSettings from "settings/mainSettings";
import { getColorRange } from "utils/color/regex";
import helpers from "utils/helpers";
import Url from "utils/Url";
import checkFiles from "./checkFiles";
import constants from "./constants";
import EditorFile from "./editorFile";
import openFile from "./openFile";
import openFolder from "./openFolder";
import run from "./run";
import saveState from "./saveState";
import appSettings from "./settings";
import showFileInfo from "./showFileInfo";

export default {
	async "close-all-tabs"() {
		let save = false;
		const unsavedFiles = editorManager.files.filter(
			(file) => file.isUnsaved,
		).length;
		if (unsavedFiles) {
			const confirmation = await confirm(
				strings["warning"],
				strings["unsaved files warning"],
			);
			if (!confirmation) return;
			const option = await select(strings["select"], [
				["save", strings["save all"]],
				["close", strings["close all"]],
				["cancel", strings["cancel"]],
			]);
			if (option === "cancel") return;

			if (option === "save") {
				const doSave = await confirm(
					strings["warning"],
					strings["save all warning"],
				);
				if (!doSave) return;
				save = true;
			} else {
				const doClose = await confirm(
					strings["warning"],
					strings["close all warning"],
				);
				if (!doClose) return;
			}
		}

		editorManager.files.forEach(async (file) => {
			if (save) {
				await file.save();
				file.remove();
				return;
			}

			file.remove(true);
		});
	},
	async "save-all-changes"() {
		const doSave = await confirm(
			strings["warning"],
			strings["save all changes warning"],
		);
		if (!doSave) return;
		editorManager.files.forEach((file) => {
			file.save();
			file.isUnsaved = false;
		});
	},
	"close-current-tab"() {
		editorManager.activeFile.remove();
	},
	console() {
		run(true, "inapp");
	},
	"check-files"() {
		if (!appSettings.value.checkFiles) return;
		checkFiles();
	},
	"command-palette"() {
		commandPalette();
	},
	"disable-fullscreen"() {
		app.classList.remove("fullscreen-mode");
		this["resize-editor"]();
	},
	"enable-fullscreen"() {
		app.classList.add("fullscreen-mode");
		this["resize-editor"]();
	},
	encoding() {
		changeEncoding();
	},
	exit() {
		navigator.app.exitApp();
	},
	"edit-with"() {
		editorManager.activeFile.editWith();
	},
	"find-file"() {
		findFile();
	},
	files() {
		FileBrowser("both", strings["file browser"])
			.then(FileBrowser.open)
			.catch(FileBrowser.openError);
	},
	find() {
		actions("search");
	},
	"file-info"(url) {
		showFileInfo(url);
	},
	async goto() {
		const res = await prompt(strings["enter line number"], "", "number", {
			placeholder: "line.column",
		});

		if (!res) return;

		const [line, col] = `${res}`.split(".");
		const editor = editorManager.editor;

		editor.focus();
		editor.gotoLine(line, col, true);
	},
	async "new-file"() {
		let filename = await prompt(strings["enter file name"], "", "filename", {
			match: constants.FILE_NAME_REGEX,
			required: true,
		});

		filename = helpers.fixFilename(filename);
		if (!filename) return;

		new EditorFile(filename, {
			isUnsaved: false,
		});
	},
	"next-file"() {
		const len = editorManager.files.length;
		let fileIndex = editorManager.files.indexOf(editorManager.activeFile);

		if (fileIndex === len - 1) fileIndex = 0;
		else ++fileIndex;

		editorManager.files[fileIndex].makeActive();
	},
	open(page) {
		switch (page) {
			case "settings":
				mainSettings();
				break;

			case "help":
				help();
				break;

			case "problems":
				Problems();
				break;

			case "plugins":
				plugins();
				break;

			case "file_browser":
				FileBrowser();
				break;

			default:
				return;
		}
		editorManager.editor.blur();
	},
	"open-with"() {
		editorManager.activeFile.openWith();
	},
	"open-file"() {
		editorManager.editor.blur();
		FileBrowser("file")
			.then(FileBrowser.openFile)
			.catch(FileBrowser.openFileError);
	},
	"open-folder"() {
		editorManager.editor.blur();
		FileBrowser("folder")
			.then(FileBrowser.openFolder)
			.catch(FileBrowser.openFolderError);
	},
	"prev-file"() {
		const len = editorManager.files.length;
		let fileIndex = editorManager.files.indexOf(editorManager.activeFile);

		if (fileIndex === 0) fileIndex = len - 1;
		else --fileIndex;

		editorManager.files[fileIndex].makeActive();
	},
	"read-only"() {
		const file = editorManager.activeFile;
		file.editable = !file.editable;
	},
	recent() {
		recents.select().then((res) => {
			const { type } = res;
			if (helpers.isFile(type)) {
				openFile(res.val, {
					render: true,
				}).catch((err) => {
					helpers.error(err);
				});
			} else if (helpers.isDir(type)) {
				openFolder(res.val.url, res.val.opts);
			} else if (res === "clear") {
				recents.clear();
			}
		});
	},
	replace() {
		this.find();
	},
	"resize-editor"() {
		editorManager.editor.resize(true);
	},
	"open-inapp-browser"(url) {
		browser.open(url);
	},
	run() {
		editorManager.activeFile[
			appSettings.value.useCurrentFileForPreview ? "runFile" : "run"
		]?.();
	},
	"run-file"() {
		editorManager.activeFile.runFile?.();
	},
	async save(showToast) {
		try {
			await editorManager.activeFile.save();
			if (showToast) {
				toast(strings["file saved"]);
			}
		} catch (error) {
			helpers.error(error);
		}
	},
	async "save-as"(showToast) {
		try {
			await editorManager.activeFile.saveAs();
			if (showToast) {
				toast(strings["file saved"]);
			}
		} catch (error) {
			helpers.error(error);
		}
	},
	"save-state"() {
		saveState();
	},
	share() {
		editorManager.activeFile.share();
	},
	syntax() {
		changeMode();
	},
	"change-app-theme"() {
		changeTheme("app");
	},
	"change-editor-theme"() {
		changeTheme("editor");
	},
	"toggle-fullscreen"() {
		app.classList.toggle("fullscreen-mode");
		this["resize-editor"]();
	},
	"toggle-sidebar"() {
		Sidebar.toggle();
	},
	"toggle-menu"() {
		tag.get("[action=toggle-menu]")?.click();
	},
	"toggle-editmenu"() {
		tag.get("[action=toggle-edit-menu")?.click();
	},
	async "insert-color"() {
		const { editor } = editorManager;
		const range = getColorRange();
		let defaultColor = range ? editor.session.getTextRange(range) : "";

		editor.blur();
		const wasFocused = editorManager.activeFile.focused;
		const res = await color(defaultColor, () => {
			if (wasFocused) {
				editor.focus();
			}
		});

		if (range) {
			editor.session.replace(range, res);
			return;
		}
		editor.insert(res);
	},
	copy() {
		editorManager.editor.execCommand("copy");
	},
	cut() {
		editorManager.editor.execCommand("cut");
	},
	paste() {
		editorManager.editor.execCommand("paste");
	},
	"select-all"() {
		const { editor } = editorManager;
		editor.execCommand("selectall");
		editor.scrollToRow(Number.POSITIVE_INFINITY);
	},
	async rename(file) {
		file = file || editorManager.activeFile;

		if (file.mode === "single") {
			alert(strings.info.toUpperCase(), strings["unable to rename"]);
			return;
		}

		let newname = await prompt(strings.rename, file.filename, "filename", {
			match: constants.FILE_NAME_REGEX,
			capitalize: false,
		});

		newname = helpers.fixFilename(newname);
		if (!newname || newname === file.filename) return;

		const { uri } = file;
		if (uri) {
			const fs = fsOperation(uri);
			try {
				let newUri;
				if (uri.startsWith("content://com.termux.documents/tree/")) {
					// Special handling for Termux content files
					const newFilePath = Url.join(Url.dirname(uri), newname);
					const content = await fs.readFile();
					await fsOperation(Url.dirname(uri)).createFile(newname, content);
					await fs.delete();
					newUri = newFilePath;
				} else {
					newUri = await fs.renameTo(newname);
				}
				const stat = await fsOperation(newUri).stat();

				newname = stat.name;
				file.uri = newUri;
				file.filename = newname;

				openFolder.renameItem(uri, newUri, newname);
				toast(strings["file renamed"]);
			} catch (err) {
				helpers.error(err);
			}
		} else {
			file.filename = newname;
		}
	},
	async format(selectIfNull) {
		const { editor } = editorManager;
		const pos = editor.getCursorPosition();

		await acode.format(selectIfNull);
		editor.selection.moveCursorToPosition(pos);
	},
	async eol() {
		const eol = await select(strings["new line mode"], ["unix", "windows"], {
			default: editorManager.activeFile.eol,
		});
		editorManager.activeFile.eol = eol;
	},
	"open-log-file"() {
		openFile(Url.join(DATA_STORAGE, constants.LOG_FILE_NAME));
	},
	"copy-device-info"() {
		let webviewInfo = {};
		let appInfo = {};
		const getWebviewInfo = new Promise((resolve, reject) => {
			system.getWebviewInfo(
				(res) => {
					webviewInfo = res;
					resolve();
				},
				(error) => {
					console.error("Error getting WebView info:", error);
					reject(error);
				},
			);
		});
		const getAppInfo = new Promise((resolve, reject) => {
			system.getAppInfo(
				(res) => {
					appInfo = res;
					resolve();
				},
				(error) => {
					console.error("Error getting app info:", error);
					reject(error);
				},
			);
		});

		Promise.all([getWebviewInfo, getAppInfo])
			.then(() => {
				let info = `Device Information:
WebView Info:
		Package Name: ${webviewInfo?.packageName || "N/A"}
		Version: ${webviewInfo?.versionName || "N/A"}

App Info:
		Name: ${appInfo?.label || "N/A"}
		Package Name: ${appInfo?.packageName || "N/A"}
		Version: ${appInfo?.versionName || "N/A"}
		Version Code: ${appInfo?.versionCode || "N/A"}

Device Info:
		Android Version: ${device?.version || "N/A"}
		Manufacturer: ${device?.manufacturer || "N/A"}
		Model: ${device?.model || "N/A"}
		Platform: ${device?.platform || "N/A"}
		Cordova Version: ${device?.cordova || "N/A"}

Screen Info:
		Width: ${screen?.width || "N/A"}
		Height: ${screen?.height || "N/A"}
		Color Depth: ${screen?.colorDepth || "N/A"}

Additional Info:
		Language: ${navigator?.language || "N/A"}
		User Agent: ${navigator?.userAgent || "N/A"}
`;

				// Copy the info to clipboard
				if (cordova.plugins.clipboard) {
					cordova.plugins.clipboard.copy(info);
					toast(strings["copied to clipboard"]);
				}
			})
			.catch((error) => {
				console.error("Error getting device info:", error);
				toast("Failed to get device info");
			});
	},
	async "new-terminal"() {
		try {
			await TerminalManager.createServerTerminal();
		} catch (error) {
			console.error("Failed to create terminal:", error);
			window.toast("Failed to create terminal");
		}
	},
};

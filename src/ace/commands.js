import fsOperation from "fileSystem";
import prompt from "dialogs/prompt";
import actions from "handlers/quickTools";
import keyBindings from "lib/keyBindings";
import settings from "lib/settings";
import Url from "utils/Url";

const commands = [
	{
		name: "focusEditor",
		description: "Focus editor",
		exec() {
			editorManager.editor.focus();
		},
	},
	{
		name: "findFile",
		description: "Find file in workspace",
		exec() {
			acode.exec("find-file");
		},
	},
	{
		name: "closeCurrentTab",
		description: "Close current tab",
		exec() {
			acode.exec("close-current-tab");
		},
	},
	{
		name: "closeAllTabs",
		description: "Close all tabs",
		exec() {
			acode.exec("close-all-tabs");
		},
	},
	{
		name: "newFile",
		description: "Create new file",
		exec() {
			acode.exec("new-file");
		},
		readOnly: true,
	},
	{
		name: "openFile",
		description: "Open a file",
		exec() {
			acode.exec("open-file");
		},
		readOnly: true,
	},
	{
		name: "openFolder",
		description: "Open a folder",
		exec() {
			acode.exec("open-folder");
		},
		readOnly: true,
	},
	{
		name: "saveFile",
		description: "Save current file",
		exec() {
			acode.exec("save");
		},
		readOnly: true,
	},
	{
		name: "saveFileAs",
		description: "Save as current file",
		exec() {
			acode.exec("save-as");
		},
		readOnly: true,
	},
	{
		name: "saveAllChanges",
		description: "Save all changes",
		exec() {
			acode.exec("save-all-changes");
		},
		readOnly: true,
	},
	{
		name: "nextFile",
		description: "Open next file tab",
		exec() {
			acode.exec("next-file");
		},
	},
	{
		name: "prevFile",
		description: "Open previous file tab",
		exec() {
			acode.exec("prev-file");
		},
	},
	{
		name: "showSettingsMenu",
		description: "Show settings menu",
		exec() {
			acode.exec("open", "settings");
		},
		readOnly: true,
	},
	{
		name: "renameFile",
		description: "Rename active file",
		exec() {
			acode.exec("rename");
		},
		readOnly: true,
	},
	{
		name: "run",
		description: "Preview HTML and MarkDown",
		exec() {
			acode.exec("run");
		},
		readOnly: true,
	},
	{
		name: "openInAppBrowser",
		description: "Open In-App Browser",
		async exec() {
			const url = await prompt("Enter url", "", "url", {
				placeholder: "http://",
				match: /^https?:\/\/.+/,
			});
			if (url) {
				acode.exec("open-inapp-browser", url);
			}
		},
	},
	{
		name: "toggleFullscreen",
		description: "Toggle full screen mode",
		exec() {
			acode.exec("toggle-fullscreen");
		},
	},
	{
		name: "toggleSidebar",
		description: "Toggle sidebar",
		exec() {
			acode.exec("toggle-sidebar");
		},
	},
	{
		name: "toggleMenu",
		description: "Toggle main menu",
		exec() {
			acode.exec("toggle-menu");
		},
	},
	{
		name: "toggleEditMenu",
		description: "Toggle edit menu",
		exec() {
			acode.exec("toggle-editmenu");
		},
	},
	{
		name: "selectall",
		description: "Select all",
		exec(editor) {
			editor.selectAll();
		},
		readOnly: true,
	},
	{
		name: "gotoline",
		description: "Go to line...",
		exec() {
			acode.exec("goto");
		},
		readOnly: true,
	},
	{
		name: "find",
		description: "Find",
		exec() {
			acode.exec("find");
		},
		readOnly: true,
	},
	{
		name: "copy",
		description: "Copy",
		exec(editor) {
			const { clipboard } = cordova.plugins;
			const copyText = editor.getCopyText();
			clipboard.copy(copyText);
			toast(strings["copied to clipboard"]);
		},
		readOnly: true,
	},
	{
		name: "cut",
		description: "Cut",
		exec(editor) {
			let cutLine =
				editor.$copyWithEmptySelection && editor.selection.isEmpty();
			let range = cutLine
				? editor.selection.getLineRange()
				: editor.selection.getRange();
			editor._emit("cut", range);
			if (!range.isEmpty()) {
				const { clipboard } = cordova.plugins;
				const copyText = editor.session.getTextRange(range);
				clipboard.copy(copyText);
				toast(strings["copied to clipboard"]);
				editor.session.remove(range);
			}
			editor.clearSelection();
		},
		scrollIntoView: "cursor",
		multiSelectAction: "forEach",
	},
	{
		name: "paste",
		description: "Paste",
		exec() {
			const { clipboard } = cordova.plugins;
			clipboard.paste((text) => {
				editorManager.editor.$handlePaste(text);
			});
		},
		scrollIntoView: "cursor",
	},
	{
		name: "problems",
		description: "Show errors and warnings",
		exec() {
			acode.exec("open", "problems");
		},
	},
	{
		name: "replace",
		description: "Replace",
		exec() {
			acode.exec("replace");
		},
	},
	{
		name: "openCommandPalette",
		description: "Open command palette",
		exec() {
			acode.exec("command-palette");
		},
		readOnly: true,
	},
	{
		name: "modeSelect",
		description: "Change language mode...",
		exec() {
			acode.exec("syntax");
		},
		readOnly: true,
	},
	{
		name: "toggleQuickTools",
		description: "Toggle quick tools",
		exec() {
			actions("toggle");
		},
	},
	{
		name: "selectWord",
		description: "Select current word",
		exec(editor) {
			editor.selection.selectAWord();
			editor._emit("select-word");
		},
	},
	{
		name: "openLogFile",
		description: "Open Log File",
		exec() {
			acode.exec("open-log-file");
		},
	},
	{
		name: "increaseFontSize",
		description: "Increase font size",
		exec(editor) {
			let size = Number.parseInt(editor.getFontSize(), 10) || 12;
			editor.setFontSize(size + 1);
			settings.value.fontSize = size + 1 + "px";
			settings.update(false);
		},
	},
	{
		name: "decreaseFontSize",
		description: "Decrease font size",
		exec(editor) {
			let size = Number.parseInt(editor.getFontSize(), 10) || 12;
			editor.setFontSize(Math.max(size - 1 || 1));
			settings.value.fontSize = Math.max(size - 1 || 1) + "px";
			settings.update(false);
		},
	},
	{
		name: "openPluginsPage",
		description: "Open Plugins Page",
		exec() {
			acode.exec("open", "plugins");
		},
		readOnly: true,
	},
	{
		name: "openFileExplorer",
		description: "File Explorer",
		exec() {
			acode.exec("open", "file_browser");
		},
		readOnly: true,
	},
	{
		name: "copyDeviceInfo",
		description: "Copy Device info",
		exec() {
			acode.exec("copy-device-info");
		},
		readOnly: true,
	},
	{
		name: "changeAppTheme",
		description: "Change App Theme",
		exec() {
			acode.exec("change-app-theme");
		},
		readOnly: true,
	},
	{
		name: "changeEditorTheme",
		description: "Change Editor Theme",
		exec() {
			acode.exec("change-editor-theme");
		},
		readOnly: true,
	},
	{
		name: "openTerminal",
		description: "Open Terminal",
		exec() {
			acode.exec("new-terminal");
		},
		readOnly: true,
	},
];

export function setCommands(editor) {
	commands.forEach((command) => {
		editor.commands.addCommand(command);
	});
}

/**
 * Sets key bindings for the editor
 * @param {AceAjax.Editor} editor Ace editor
 */
export async function setKeyBindings({ commands }) {
	let keyboardShortcuts = keyBindings;
	try {
		const bindingsFile = fsOperation(KEYBINDING_FILE);
		if (await bindingsFile.exists()) {
			const bindings = await bindingsFile.readFile("json");
			// keyboardShortcuts = compareAndFixKeyBindings(keyboardShortcuts, bindings);
			keyboardShortcuts = bindings;
		} else {
			throw new Error("Key binding file not found");
		}
	} catch (error) {
		await resetKeyBindings();
	}

	Object.keys(commands.byName).forEach((name) => {
		const shortcut = keyboardShortcuts[name];
		const command = commands.byName[name];

		if (shortcut?.description) {
			command.description = shortcut.description;
		}

		// not chekiang if shortcut is empty because it can be used to remove shortcut
		command.bindKey = { win: shortcut?.key ?? null };
		commands.addCommand(command);
	});
}

/**
 * Resets key binding
 */
export async function resetKeyBindings() {
	try {
		const fs = fsOperation(KEYBINDING_FILE);
		const fileName = Url.basename(KEYBINDING_FILE);
		const content = JSON.stringify(keyBindings, undefined, 2);
		if (!(await fs.exists())) {
			await fsOperation(DATA_STORAGE).createFile(fileName, content);
			return;
		}
		await fs.writeFile(content);
	} catch (error) {
		window.log("error", "Reset Keybinding failed!");
		window.log("error", error);
	}
}

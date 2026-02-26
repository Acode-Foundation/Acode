import fsOperation from "fileSystem";
import * as cmCommands from "@codemirror/commands";
import {
	copyLineDown,
	copyLineUp,
	cursorCharLeft,
	cursorCharRight,
	cursorDocEnd,
	cursorDocStart,
	cursorGroupLeft,
	cursorGroupRight,
	cursorLineDown,
	cursorLineEnd,
	cursorLineStart,
	cursorLineUp,
	cursorMatchingBracket,
	cursorPageDown,
	cursorPageUp,
	deleteCharBackward,
	deleteCharForward,
	deleteGroupBackward,
	deleteGroupForward,
	deleteLine,
	deleteLineBoundaryForward,
	deleteToLineEnd,
	deleteToLineStart,
	indentLess,
	indentMore,
	indentSelection,
	insertBlankLine,
	insertNewlineAndIndent,
	lineComment,
	lineUncomment,
	moveLineDown,
	moveLineUp,
	redo,
	selectAll,
	selectCharLeft,
	selectCharRight,
	selectDocEnd,
	selectDocStart,
	selectGroupLeft,
	selectGroupRight,
	selectLine,
	selectLineDown,
	selectLineEnd,
	selectLineStart,
	selectLineUp,
	selectMatchingBracket,
	selectPageDown,
	selectPageUp,
	simplifySelection,
	toggleBlockComment,
	undo,
} from "@codemirror/commands";
import { indentUnit as indentUnitFacet } from "@codemirror/language";
import {
	closeLintPanel,
	forceLinting,
	nextDiagnostic,
	openLintPanel,
	previousDiagnostic,
} from "@codemirror/lint";
import {
	LSPPlugin,
	closeReferencePanel as lspCloseReferencePanel,
	findReferences as lspFindReferences,
	formatDocument as lspFormatDocument,
	jumpToDeclaration as lspJumpToDeclaration,
	jumpToDefinition as lspJumpToDefinition,
	jumpToImplementation as lspJumpToImplementation,
	jumpToTypeDefinition as lspJumpToTypeDefinition,
	nextSignature as lspNextSignature,
	prevSignature as lspPrevSignature,
	showSignatureHelp as lspShowSignatureHelp,
} from "@codemirror/lsp-client";
import { Compartment, EditorSelection } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import {
	renameSymbol as acodeRenameSymbol,
	clearDiagnosticsEffect,
	clientManager,
} from "cm/lsp";
import {
	closeReferencesPanel as acodeCloseReferencesPanel,
	findAllReferences as acodeFindAllReferences,
	findAllReferencesInTab as acodeFindAllReferencesInTab,
} from "cm/lsp/references";
import { showDocumentSymbols } from "components/symbolsPanel";
import toast from "components/toast";
import prompt from "dialogs/prompt";
import actions from "handlers/quickTools";
import keyBindings from "lib/keyBindings";
import settings from "lib/settings";
import Url from "utils/Url";

const commandKeymapCompartment = new Compartment();

/**
 * @typedef {import("@codemirror/view").EditorView} EditorView
 */

/**
 * @typedef {{
 *  name: string;
 *  description?: string;
 *  readOnly?: boolean;
 *  run: (view?: EditorView | null) => boolean | void;
 *  requiresView?: boolean;
 *  defaultDescription?: string;
 *  key?: string | null;
 * }} CommandEntry
 */

/** @type {Map<string, CommandEntry>} */
const commandMap = new Map();

/** @type {Record<string, any>} */
let resolvedKeyBindings = keyBindings;

/** @type {import("@codemirror/view").KeyBinding[]} */
let cachedKeymap = [];

const ARROW_KEY_MAP = {
	left: "ArrowLeft",
	right: "ArrowRight",
	up: "ArrowUp",
	down: "ArrowDown",
};

const SPECIAL_KEY_MAP = {
	esc: "Escape",
	escape: "Escape",
	return: "Enter",
	enter: "Enter",
	space: "Space",
	del: "Delete",
	delete: "Delete",
	backspace: "Backspace",
	tab: "Tab",
	home: "Home",
	end: "End",
	pageup: "PageUp",
	pagedown: "PageDown",
	insert: "Insert",
};

const MODIFIER_MAP = {
	ctrl: "Mod",
	control: "Mod",
	cmd: "Mod",
	meta: "Mod",
	shift: "Shift",
	alt: "Alt",
	option: "Alt",
};

const CODEMIRROR_COMMAND_ENTRIES = Object.entries(cmCommands).filter(
	([, value]) => typeof value === "function",
);

const CODEMIRROR_COMMAND_MAP = new Map(
	CODEMIRROR_COMMAND_ENTRIES.map(([name, fn]) => [name, fn]),
);

registerCoreCommands();
registerLspCommands();
registerLintCommands();
registerCommandsFromKeyBindings();
rebuildKeymap();

function registerCoreCommands() {
	addCommand({
		name: "focusEditor",
		description: "Focus editor",
		readOnly: true,
		requiresView: false,
		run(view) {
			const resolvedView = resolveView(view);
			resolvedView?.focus();
			return true;
		},
	});
	addCommand({
		name: "findFile",
		description: "Find file in workspace",
		readOnly: true,
		requiresView: false,
		run() {
			acode.exec("find-file");
			return true;
		},
	});
	addCommand({
		name: "closeCurrentTab",
		description: "Close current tab",
		readOnly: false,
		requiresView: false,
		run() {
			acode.exec("close-current-tab");
			return true;
		},
	});
	addCommand({
		name: "closeAllTabs",
		description: "Close all tabs",
		readOnly: false,
		requiresView: false,
		run() {
			acode.exec("close-all-tabs");
			return true;
		},
	});
	addCommand({
		name: "newFile",
		description: "Create new file",
		readOnly: true,
		requiresView: false,
		run() {
			acode.exec("new-file");
			return true;
		},
	});
	addCommand({
		name: "openFile",
		description: "Open a file",
		readOnly: true,
		requiresView: false,
		run() {
			acode.exec("open-file");
			return true;
		},
	});
	addCommand({
		name: "openFolder",
		description: "Open a folder",
		readOnly: true,
		requiresView: false,
		run() {
			acode.exec("open-folder");
			return true;
		},
	});
	addCommand({
		name: "saveFile",
		description: "Save current file",
		readOnly: true,
		requiresView: false,
		run() {
			acode.exec("save");
			return true;
		},
	});
	addCommand({
		name: "saveFileAs",
		description: "Save as current file",
		readOnly: true,
		requiresView: false,
		run() {
			acode.exec("save-as");
			return true;
		},
	});
	addCommand({
		name: "saveAllChanges",
		description: "Save all changes",
		readOnly: true,
		requiresView: false,
		run() {
			acode.exec("save-all-changes");
			return true;
		},
	});
	addCommand({
		name: "nextFile",
		description: "Open next file tab",
		readOnly: true,
		requiresView: false,
		run() {
			acode.exec("next-file");
			return true;
		},
	});
	addCommand({
		name: "prevFile",
		description: "Open previous file tab",
		readOnly: true,
		requiresView: false,
		run() {
			acode.exec("prev-file");
			return true;
		},
	});
	addCommand({
		name: "showSettingsMenu",
		description: "Show settings menu",
		readOnly: true,
		requiresView: false,
		run() {
			acode.exec("open", "settings");
			return true;
		},
	});
	addCommand({
		name: "renameFile",
		description: "Rename active file",
		readOnly: true,
		requiresView: false,
		run() {
			acode.exec("rename");
			return true;
		},
	});
	addCommand({
		name: "run",
		description: "Preview HTML and MarkDown",
		readOnly: true,
		requiresView: false,
		run() {
			acode.exec("run");
			return true;
		},
	});
	addCommand({
		name: "openInAppBrowser",
		description: "Open In-App Browser",
		readOnly: true,
		requiresView: false,
		run: openInAppBrowserCommand,
	});
	addCommand({
		name: "toggleFullscreen",
		description: "Toggle full screen mode",
		readOnly: true,
		requiresView: false,
		run() {
			acode.exec("toggle-fullscreen");
			return true;
		},
	});
	addCommand({
		name: "toggleSidebar",
		description: "Toggle sidebar",
		readOnly: true,
		requiresView: false,
		run() {
			acode.exec("toggle-sidebar");
			return true;
		},
	});
	addCommand({
		name: "toggleMenu",
		description: "Toggle main menu",
		readOnly: true,
		requiresView: false,
		run() {
			acode.exec("toggle-menu");
			return true;
		},
	});
	addCommand({
		name: "toggleEditMenu",
		description: "Toggle edit menu",
		readOnly: true,
		requiresView: false,
		run() {
			acode.exec("toggle-editmenu");
			return true;
		},
	});
	addCommand({
		name: "selectall",
		description: "Select all",
		readOnly: true,
		requiresView: true,
		run(view) {
			const resolvedView = resolveView(view);
			if (!resolvedView) return false;
			return selectAll(resolvedView);
		},
	});
	addCommand({
		name: "gotoline",
		description: "Go to line...",
		readOnly: true,
		requiresView: false,
		run() {
			acode.exec("goto");
			return true;
		},
	});
	addCommand({
		name: "find",
		description: "Find",
		readOnly: true,
		requiresView: false,
		run() {
			acode.exec("find");
			return true;
		},
	});
	addCommand({
		name: "copy",
		description: "Copy",
		readOnly: true,
		requiresView: true,
		run: copyCommand,
	});
	addCommand({
		name: "cut",
		description: "Cut",
		readOnly: false,
		requiresView: true,
		run: cutCommand,
	});
	addCommand({
		name: "paste",
		description: "Paste",
		readOnly: false,
		requiresView: true,
		run: pasteCommand,
	});
	addCommand({
		name: "problems",
		description: "Show errors and warnings",
		readOnly: true,
		requiresView: false,
		run() {
			acode.exec("open", "problems");
			return true;
		},
	});
	addCommand({
		name: "replace",
		description: "Replace",
		readOnly: true,
		requiresView: false,
		run() {
			acode.exec("replace");
			return true;
		},
	});
	addCommand({
		name: "openCommandPalette",
		description: "Open command palette",
		readOnly: true,
		requiresView: false,
		run() {
			acode.exec("command-palette");
			return true;
		},
	});
	addCommand({
		name: "modeSelect",
		description: "Change language mode...",
		readOnly: true,
		requiresView: false,
		run() {
			acode.exec("syntax");
			return true;
		},
	});
	addCommand({
		name: "toggleQuickTools",
		description: "Toggle quick tools",
		readOnly: true,
		requiresView: false,
		run() {
			actions("toggle");
			return true;
		},
	});
	addCommand({
		name: "selectWord",
		description: "Select current word",
		readOnly: false,
		requiresView: true,
		run: selectWordCommand,
	});
	addCommand({
		name: "openLogFile",
		description: "Open Log File",
		readOnly: true,
		requiresView: false,
		run() {
			acode.exec("open-log-file");
			return true;
		},
	});
	addCommand({
		name: "increaseFontSize",
		description: "Increase font size",
		readOnly: false,
		requiresView: false,
		run: () => adjustFontSize(1),
	});
	addCommand({
		name: "decreaseFontSize",
		description: "Decrease font size",
		readOnly: false,
		requiresView: false,
		run: () => adjustFontSize(-1),
	});
	addCommand({
		name: "openPluginsPage",
		description: "Open Plugins Page",
		readOnly: true,
		requiresView: false,
		run() {
			acode.exec("open", "plugins");
			return true;
		},
	});
	addCommand({
		name: "openFileExplorer",
		description: "File Explorer",
		readOnly: true,
		requiresView: false,
		run() {
			acode.exec("open", "file_browser");
			return true;
		},
	});
	addCommand({
		name: "copyDeviceInfo",
		description: "Copy Device info",
		readOnly: true,
		requiresView: false,
		run() {
			acode.exec("copy-device-info");
			return true;
		},
	});
	addCommand({
		name: "changeAppTheme",
		description: "Change App Theme",
		readOnly: true,
		requiresView: false,
		run() {
			acode.exec("change-app-theme");
			return true;
		},
	});
	addCommand({
		name: "changeEditorTheme",
		description: "Change Editor Theme",
		readOnly: true,
		requiresView: false,
		run() {
			acode.exec("change-editor-theme");
			return true;
		},
	});
	addCommand({
		name: "openTerminal",
		description: "Open Terminal",
		readOnly: true,
		requiresView: false,
		run() {
			acode.exec("new-terminal");
			return true;
		},
	});
	addCommand({
		name: "acode:showWelcome",
		description: "Show Welcome",
		readOnly: true,
		requiresView: false,
		run() {
			acode.exec("welcome");
			return true;
		},
	});
	addCommand({
		name: "run-tests",
		description: "Run Tests",
		key: "Ctrl-Shift-T",
		readOnly: true,
		requiresView: false,
		run() {
			acode.exec("run-tests");
			return true;
		},
	});
	addCommand({
		name: "dev:openInspector",
		description: "Open Inspector",
		run() {
			acode.exec("open-inspector");
			return true;
		},
		readOnly: true,
		requiresView: false,
	});
	addCommand({
		name: "dev:toggleDevTools",
		description: "Toggle Developer Tools",
		run() {
			acode.exec("toggle-inspector");
			return true;
		},
		readOnly: true,
		requiresView: false,
		key: "Ctrl-Shift-I",
	});

	// Additional editor-centric helpers mapped to CodeMirror primitives that have existing key bindings in defaults.
	addCommand({
		name: "duplicateSelection",
		description: "Duplicate selection",
		readOnly: false,
		requiresView: true,
		run(view) {
			const resolvedView = resolveView(view);
			if (!resolvedView) return false;
			return copyLineDown(resolvedView);
		},
	});
	addCommand({
		name: "copylinesdown",
		description: "Copy lines down",
		readOnly: false,
		requiresView: true,
		run(view) {
			const resolvedView = resolveView(view);
			if (!resolvedView) return false;
			return copyLineDown(resolvedView);
		},
	});
	addCommand({
		name: "copylinesup",
		description: "Copy lines up",
		readOnly: false,
		requiresView: true,
		run(view) {
			const resolvedView = resolveView(view);
			if (!resolvedView) return false;
			return copyLineUp(resolvedView);
		},
	});
	addCommand({
		name: "movelinesdown",
		description: "Move lines down",
		readOnly: false,
		requiresView: true,
		run(view) {
			const resolvedView = resolveView(view);
			if (!resolvedView) return false;
			return moveLineDown(resolvedView);
		},
	});
	addCommand({
		name: "movelinesup",
		description: "Move lines up",
		readOnly: false,
		requiresView: true,
		run(view) {
			const resolvedView = resolveView(view);
			if (!resolvedView) return false;
			return moveLineUp(resolvedView);
		},
	});
	addCommand({
		name: "removeline",
		description: "Remove line",
		readOnly: false,
		requiresView: true,
		run(view) {
			const resolvedView = resolveView(view);
			if (!resolvedView) return false;
			return deleteLine(resolvedView);
		},
	});
	addCommand({
		name: "insertlineafter",
		description: "Insert line after",
		readOnly: false,
		requiresView: true,
		run(view) {
			const resolvedView = resolveView(view);
			if (!resolvedView) return false;
			return insertBlankLine(resolvedView);
		},
	});
	addCommand({
		name: "selectline",
		description: "Select line",
		readOnly: true,
		requiresView: true,
		run(view) {
			const resolvedView = resolveView(view);
			if (!resolvedView) return false;
			return selectLine(resolvedView);
		},
	});
	addCommand({
		name: "selectlinesdown",
		description: "Select line down",
		readOnly: true,
		requiresView: true,
		run(view) {
			const resolvedView = resolveView(view);
			if (!resolvedView) return false;
			return selectLineDown(resolvedView);
		},
	});
	addCommand({
		name: "selectlinesup",
		description: "Select line up",
		readOnly: true,
		requiresView: true,
		run(view) {
			const resolvedView = resolveView(view);
			if (!resolvedView) return false;
			return selectLineUp(resolvedView);
		},
	});
	addCommand({
		name: "selectlinestart",
		description: "Select line start",
		readOnly: true,
		requiresView: true,
		run(view) {
			const resolvedView = resolveView(view);
			if (!resolvedView) return false;
			return selectLineStart(resolvedView);
		},
	});
	addCommand({
		name: "selectlineend",
		description: "Select line end",
		readOnly: true,
		requiresView: true,
		run(view) {
			const resolvedView = resolveView(view);
			if (!resolvedView) return false;
			return selectLineEnd(resolvedView);
		},
	});
	addCommand({
		name: "indent",
		description: "Indent",
		readOnly: false,
		requiresView: true,
		run(view) {
			const resolvedView = resolveView(view);
			if (!resolvedView) return false;
			const { state } = resolvedView;
			const hasSelection = state.selection.ranges.some((range) => !range.empty);
			if (hasSelection) {
				return indentMore(resolvedView);
			}
			const indentString =
				state.facet(indentUnitFacet) ||
				(settings?.value?.softTab
					? " ".repeat(Math.max(1, Number(settings?.value?.tabSize) || 2))
					: "\t");
			const insert = indentString && indentString.length ? indentString : "\t";
			resolvedView.dispatch(
				state.changeByRange((range) => ({
					changes: { from: range.from, to: range.to, insert },
					range: EditorSelection.cursor(range.from + insert.length),
				})),
			);
			return true;
		},
	});
	addCommand({
		name: "outdent",
		description: "Outdent",
		readOnly: false,
		requiresView: true,
		run(view) {
			const resolvedView = resolveView(view);
			if (!resolvedView) return false;
			return indentLess(resolvedView);
		},
	});
	addCommand({
		name: "indentselection",
		description: "Indent selection",
		readOnly: false,
		requiresView: true,
		run(view) {
			const resolvedView = resolveView(view);
			if (!resolvedView) return false;
			return indentSelection(resolvedView);
		},
	});
	addCommand({
		name: "newline",
		description: "Insert newline",
		readOnly: false,
		requiresView: true,
		run(view) {
			const resolvedView = resolveView(view);
			if (!resolvedView) return false;
			return insertNewlineAndIndent(resolvedView);
		},
	});
	addCommand({
		name: "joinlines",
		description: "Join lines",
		readOnly: false,
		requiresView: true,
		run(view) {
			const resolvedView = resolveView(view);
			if (!resolvedView) return false;
			return deleteLineBoundaryForward(resolvedView);
		},
	});
	addCommand({
		name: "deletetolinestart",
		description: "Delete to line start",
		readOnly: false,
		requiresView: true,
		run(view) {
			const resolvedView = resolveView(view);
			if (!resolvedView) return false;
			return deleteToLineStart(resolvedView);
		},
	});
	addCommand({
		name: "deletetolineend",
		description: "Delete to line end",
		readOnly: false,
		requiresView: true,
		run(view) {
			const resolvedView = resolveView(view);
			if (!resolvedView) return false;
			return deleteToLineEnd(resolvedView);
		},
	});
	addCommand({
		name: "togglecomment",
		description: "Toggle comment",
		readOnly: false,
		requiresView: true,
		run(view) {
			const resolvedView = resolveView(view);
			if (!resolvedView) return false;
			return lineComment(resolvedView);
		},
	});
	addCommand({
		name: "comment",
		description: "Add line comment",
		readOnly: false,
		requiresView: true,
		run(view) {
			const resolvedView = resolveView(view);
			if (!resolvedView) return false;
			return lineComment(resolvedView);
		},
	});
	addCommand({
		name: "uncomment",
		description: "Remove line comment",
		readOnly: false,
		requiresView: true,
		run(view) {
			const resolvedView = resolveView(view);
			if (!resolvedView) return false;
			return lineUncomment(resolvedView);
		},
	});
	addCommand({
		name: "toggleBlockComment",
		description: "Toggle block comment",
		readOnly: false,
		requiresView: true,
		run(view) {
			const resolvedView = resolveView(view);
			if (!resolvedView) return false;
			return toggleBlockComment(resolvedView);
		},
	});
	addCommand({
		name: "undo",
		description: "Undo",
		readOnly: false,
		requiresView: true,
		run(view) {
			const resolvedView = resolveView(view);
			if (!resolvedView) return false;
			return undo(resolvedView);
		},
	});
	addCommand({
		name: "redo",
		description: "Redo",
		readOnly: false,
		requiresView: true,
		run(view) {
			const resolvedView = resolveView(view);
			if (!resolvedView) return false;
			return redo(resolvedView);
		},
	});
	addCommand({
		name: "simplifySelection",
		description: "Simplify selection",
		readOnly: true,
		requiresView: true,
		run(view) {
			const resolvedView = resolveView(view);
			if (!resolvedView) return false;
			return simplifySelection(resolvedView);
		},
	});
}

function registerLspCommands() {
	addCommand({
		name: "formatDocument",
		description: "Format document (Language Server)",
		readOnly: false,
		requiresView: true,
		run: runLspCommand(lspFormatDocument),
	});
	addCommand({
		name: "renameSymbol",
		description: "Rename symbol (Language Server)",
		readOnly: false,
		requiresView: true,
		run: runLspCommand(acodeRenameSymbol),
	});
	addCommand({
		name: "showSignatureHelp",
		description: "Show signature help",
		readOnly: true,
		requiresView: true,
		run: runLspCommand(lspShowSignatureHelp),
	});
	addCommand({
		name: "nextSignature",
		description: "Next signature",
		readOnly: true,
		requiresView: true,
		run: runLspCommand(lspNextSignature, { silentOnMissing: true }),
	});
	addCommand({
		name: "prevSignature",
		description: "Previous signature",
		readOnly: true,
		requiresView: true,
		run: runLspCommand(lspPrevSignature, { silentOnMissing: true }),
	});
	addCommand({
		name: "jumpToDefinition",
		description: "Go to definition (Language Server)",
		readOnly: true,
		requiresView: true,
		run: runLspCommand(lspJumpToDefinition),
	});
	addCommand({
		name: "jumpToDeclaration",
		description: "Go to declaration (Language Server)",
		readOnly: true,
		requiresView: true,
		run: runLspCommand(lspJumpToDeclaration),
	});
	addCommand({
		name: "jumpToTypeDefinition",
		description: "Go to type definition (Language Server)",
		readOnly: true,
		requiresView: true,
		run: runLspCommand(lspJumpToTypeDefinition),
	});
	addCommand({
		name: "jumpToImplementation",
		description: "Go to implementation (Language Server)",
		readOnly: true,
		requiresView: true,
		run: runLspCommand(lspJumpToImplementation),
	});
	addCommand({
		name: "findReferences",
		description: "Find all references (Language Server)",
		readOnly: true,
		requiresView: true,
		async run(view) {
			const resolvedView = resolveView(view);
			if (!resolvedView) return false;
			const plugin = LSPPlugin.get(resolvedView);
			if (!plugin) {
				notifyLspUnavailable();
				return false;
			}
			return acodeFindAllReferences(resolvedView);
		},
	});
	addCommand({
		name: "closeReferencePanel",
		description: "Close references panel",
		readOnly: true,
		requiresView: false,
		run() {
			return acodeCloseReferencesPanel();
		},
	});
	addCommand({
		name: "findReferencesInTab",
		description: "Find all references in new tab (Language Server)",
		readOnly: true,
		requiresView: true,
		async run(view) {
			const resolvedView = resolveView(view);
			if (!resolvedView) return false;
			const plugin = LSPPlugin.get(resolvedView);
			if (!plugin) {
				notifyLspUnavailable();
				return false;
			}
			return acodeFindAllReferencesInTab(resolvedView);
		},
	});
	addCommand({
		name: "restartAllLspServers",
		description: "Restart all running LSP servers",
		readOnly: true,
		requiresView: false,
		async run() {
			const activeClients = clientManager.getActiveClients();
			if (!activeClients.length) {
				toast("No LSP servers are currently running");
				return true;
			}
			const count = activeClients.length;
			toast(`Restarting ${count} LSP server${count > 1 ? "s" : ""}...`);

			// Dispose all clients (also clears diagnostics)
			await clientManager.dispose();

			// Trigger reconnect for active file
			editorManager?.restartLsp?.();
			return true;
		},
	});
	addCommand({
		name: "stopAllLspServers",
		description: "Stop all running LSP servers",
		readOnly: true,
		requiresView: false,
		async run() {
			const activeClients = clientManager.getActiveClients();
			if (!activeClients.length) {
				toast("No LSP servers are currently running");
				return true;
			}
			const count = activeClients.length;

			// Dispose all clients
			await clientManager.dispose();
			toast(`Stopped ${count} LSP server${count > 1 ? "s" : ""}`);
			return true;
		},
	});
	addCommand({
		name: "documentSymbols",
		description: "Go to Symbol in Document...",
		readOnly: true,
		requiresView: true,
		async run(view) {
			const resolvedView = resolveView(view);
			if (!resolvedView) return false;
			return showDocumentSymbols(resolvedView);
		},
	});
}

function registerLintCommands() {
	addCommand({
		name: "openLintPanel",
		description: "Open lint panel",
		readOnly: true,
		requiresView: true,
		run(view) {
			const resolvedView = resolveView(view);
			if (!resolvedView) return false;
			return openLintPanel(resolvedView);
		},
	});
	addCommand({
		name: "closeLintPanel",
		description: "Close lint panel",
		readOnly: true,
		requiresView: true,
		run(view) {
			const resolvedView = resolveView(view);
			if (!resolvedView) return false;
			return closeLintPanel(resolvedView);
		},
	});
	addCommand({
		name: "nextDiagnostic",
		description: "Go to next diagnostic",
		readOnly: true,
		requiresView: true,
		run(view) {
			const resolvedView = resolveView(view);
			if (!resolvedView) return false;
			return nextDiagnostic(resolvedView);
		},
	});
	addCommand({
		name: "previousDiagnostic",
		description: "Go to previous diagnostic",
		readOnly: true,
		requiresView: true,
		run(view) {
			const resolvedView = resolveView(view);
			if (!resolvedView) return false;
			return previousDiagnostic(resolvedView);
		},
	});
}

function registerCommandsFromKeyBindings() {
	Object.entries(keyBindings).forEach(([name, binding]) => {
		if (commandMap.has(name)) return;
		const description = binding?.description || humanizeCommandName(name);
		const readOnly = binding?.readOnly ?? false;
		const requiresView = !!binding?.editorOnly;
		const commandFn = CODEMIRROR_COMMAND_MAP.get(name);

		if (binding?.action) {
			addCommand({
				name,
				description,
				readOnly,
				requiresView,
				run(view) {
					try {
						if (requiresView) {
							const resolvedView = resolveView(view);
							if (!resolvedView) return false;
						}
						acode.exec(binding.action);
						return true;
					} catch (error) {
						console.error(`Failed to execute action ${binding.action}`, error);
						return false;
					}
				},
			});
			return;
		}

		if (commandFn) {
			addCommand({
				name,
				description,
				readOnly,
				requiresView: true,
				run(view) {
					const resolvedView = resolveView(view);
					if (!resolvedView) return false;
					return commandFn(resolvedView);
				},
			});
		}
	});
}

function addCommand(entry) {
	const command = {
		...entry,
		defaultDescription: entry.description || entry.name,
		key: entry.key ?? null,
	};
	commandMap.set(entry.name, command);
}

function resolveView(view) {
	return view || editorManager?.editor || null;
}

function notifyLspUnavailable() {
	toast?.("Language server not available");
}

function runLspCommand(commandFn, options = {}) {
	return (view) => {
		const resolvedView = resolveView(view);
		if (!resolvedView) return false;
		const plugin = LSPPlugin.get(resolvedView);
		if (!plugin) {
			if (!options?.silentOnMissing) {
				notifyLspUnavailable();
			}
			return false;
		}
		const result = commandFn(resolvedView);
		return result !== false;
	};
}

function humanizeCommandName(name) {
	return name
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replace(/_/g, " ")
		.replace(/^./, (char) => char.toUpperCase());
}

function copyCommand(view) {
	const resolvedView = resolveView(view);
	if (!resolvedView) return false;
	const { state } = resolvedView;
	const texts = state.selection.ranges.map((range) => {
		if (range.empty) {
			const line = state.doc.lineAt(range.head);
			return state.doc.sliceString(line.from, line.to);
		}
		return state.doc.sliceString(range.from, range.to);
	});
	const textToCopy = texts.join("\n");
	cordova.plugins.clipboard.copy(textToCopy);
	toast?.(strings?.["copied to clipboard"] || "Copied to clipboard");
	return true;
}

function cutCommand(view) {
	const resolvedView = resolveView(view);
	if (!resolvedView) return false;
	const { state } = resolvedView;
	const ranges = state.selection.ranges;
	const segments = [];
	let changes = [];
	ranges.forEach((range) => {
		if (range.empty) {
			const line = state.doc.lineAt(range.head);
			segments.push(state.doc.sliceString(line.from, line.to));
			changes.push({ from: line.from, to: line.to, insert: "" });
			return;
		}
		segments.push(state.doc.sliceString(range.from, range.to));
		changes.push({ from: range.from, to: range.to, insert: "" });
	});
	cordova.plugins.clipboard.copy(segments.join("\n"));
	resolvedView.dispatch({
		changes,
		selection: EditorSelection.single(
			changes[0]?.from ?? state.selection.main.from,
		),
	});
	return true;
}

function pasteCommand(view) {
	const resolvedView = resolveView(view);
	if (!resolvedView) return false;
	cordova.plugins.clipboard.paste((text = "") => {
		const insertText = String(text);
		resolvedView.dispatch(
			resolvedView.state.changeByRange((range) => ({
				changes: { from: range.from, to: range.to, insert: insertText },
				range: EditorSelection.cursor(range.from + insertText.length),
			})),
		);
	});
	return true;
}

function selectWordCommand(view) {
	const resolvedView = resolveView(view);
	if (!resolvedView) return false;
	const { state } = resolvedView;
	const ranges = state.selection.ranges.map((range) => {
		const word = state.wordAt(range.head);
		if (word) return EditorSelection.range(word.from, word.to);
		const line = state.doc.lineAt(range.head);
		return EditorSelection.range(line.from, line.to);
	});
	resolvedView.dispatch({
		selection: EditorSelection.create(ranges, state.selection.mainIndex),
	});
	return true;
}

async function openInAppBrowserCommand() {
	const url = await prompt("Enter url", "", "url", {
		placeholder: "http://",
		match: /^https?:\/\/.+/,
	});
	if (url) acode.exec("open-inapp-browser", url);
	return true;
}

function adjustFontSize(delta) {
	const current = settings?.value?.fontSize || "12px";
	const numeric = Number.parseInt(current, 10) || 12;
	const next = Math.max(1, numeric + delta);
	settings.value.fontSize = `${next}px`;
	settings.update(false);
	return true;
}

function parseKeyString(keyString) {
	if (!keyString) return [];
	return String(keyString)
		.split("|")
		.map((combo) => combo.trim())
		.filter(Boolean);
}

function toCodeMirrorKey(combo) {
	if (!combo) return null;
	const parts = combo
		.split("-")
		.map((part) => part.trim())
		.filter(Boolean);
	const modifiers = [];
	let key = null;

	parts.forEach((part, index) => {
		const lower = part.toLowerCase();
		if (MODIFIER_MAP[lower]) {
			const mod = MODIFIER_MAP[lower];
			if (!modifiers.includes(mod)) modifiers.push(mod);
			return;
		}

		if (ARROW_KEY_MAP[lower]) {
			key = ARROW_KEY_MAP[lower];
			return;
		}

		if (SPECIAL_KEY_MAP[lower]) {
			key = SPECIAL_KEY_MAP[lower];
			return;
		}

		if (part.length === 1 && /[a-z]/i.test(part)) {
			key = part.length === 1 ? part.toLowerCase() : part;
			return;
		}

		key = part;
	});

	if (!key) return modifiers.join("-") || null;
	return modifiers.length ? `${modifiers.join("-")}-${key}` : key;
}

function rebuildKeymap() {
	const bindings = [];
	commandMap.forEach((command, name) => {
		const bindingInfo = resolvedKeyBindings?.[name];
		command.description =
			bindingInfo?.description || command.defaultDescription;
		const keySource = bindingInfo?.key ?? command.key ?? null;
		command.key = keySource;
		const combos = parseKeyString(keySource);
		combos.forEach((combo) => {
			const cmKey = toCodeMirrorKey(combo);
			if (!cmKey) return;
			bindings.push({
				key: cmKey,
				run: (view) => executeCommand(name, view),
				preventDefault: true,
			});
		});
	});
	cachedKeymap = bindings;
	return bindings;
}

function resolveCommand(name) {
	return commandMap.get(name) || null;
}

function commandRunsInReadOnly(command, view) {
	if (!view) return command.readOnly;
	return view.state?.readOnly ? !!command.readOnly : true;
}

export function executeCommand(name, view, args) {
	const command = resolveCommand(name);
	if (!command) return false;
	const targetView = command.requiresView
		? resolveView(view)
		: resolveView(view) || null;
	if (command.requiresView && !targetView) return false;
	if (!commandRunsInReadOnly(command, targetView)) return false;
	try {
		const result = command.run(targetView, args);
		return result !== false;
	} catch (error) {
		console.error(`Failed to execute command ${name}`, error);
		return false;
	}
}

export function getRegisteredCommands() {
	return Array.from(commandMap.values()).map((command) => ({
		name: command.name,
		description: command.description || command.defaultDescription,
		key: command.key || null,
	}));
}

export function getCommandKeymapExtension() {
	return commandKeymapCompartment.of(keymap.of(cachedKeymap));
}

export async function setKeyBindings(view) {
	await loadCustomKeyBindings();
	const bindings = rebuildKeymap();
	const resolvedView = resolveView(view);
	applyCommandKeymap(resolvedView, bindings);
}

async function loadCustomKeyBindings() {
	try {
		const bindingsFile = fsOperation(KEYBINDING_FILE);
		if (await bindingsFile.exists()) {
			const bindings = await bindingsFile.readFile("json");
			if (bindings && typeof bindings === "object") {
				resolvedKeyBindings = bindings;
			}
		} else {
			throw new Error("Key binding file not found");
		}
	} catch (error) {
		await resetKeyBindings();
		resolvedKeyBindings = keyBindings;
	}
}

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
		window.log?.("error", "Reset Keybinding failed!");
		window.log?.("error", error);
	}
}

export { commandKeymapCompartment };

export function registerExternalCommand(descriptor = {}) {
	const normalized = normalizeExternalCommand(descriptor);
	if (!normalized) return null;

	const { name } = normalized;
	if (commandMap.has(name)) {
		commandMap.delete(name);
	}

	addCommand(normalized);
	const stored = commandMap.get(name);
	if (stored) {
		stored.key = normalized.key ?? stored.key;
	}

	rebuildKeymap();
	return stored;
}

export function removeExternalCommand(name) {
	if (!name) return false;
	const exists = commandMap.has(name);
	if (!exists) return false;
	commandMap.delete(name);
	rebuildKeymap();
	return true;
}

export function refreshCommandKeymap(view) {
	const resolvedView = resolveView(view);
	applyCommandKeymap(resolvedView);
}

function normalizeExternalCommand(descriptor) {
	const name =
		typeof descriptor?.name === "string" ? descriptor.name.trim() : "";
	if (!name) {
		console.warn("Command registration skipped: missing name", descriptor);
		return null;
	}
	const exec = typeof descriptor?.exec === "function" ? descriptor.exec : null;
	if (!exec) {
		console.warn(
			`Command registration skipped for "${name}": exec must be a function.`,
		);
		return null;
	}

	const requiresView = descriptor?.requiresView ?? true;
	const key = normalizeExternalKey(descriptor?.bindKey);

	return {
		name,
		description: descriptor?.description || humanizeCommandName(name),
		readOnly: descriptor?.readOnly ?? true,
		requiresView,
		key,
		run(view, args) {
			try {
				const resolvedView = resolveView(view);
				if (requiresView && !resolvedView) return false;
				const result = exec(resolvedView || null, args);
				return result !== false;
			} catch (error) {
				console.error(`Command \"${name}\" failed`, error);
				return false;
			}
		},
	};
}

function normalizeExternalKey(bindKey) {
	if (!bindKey) return null;
	if (typeof bindKey === "string") return bindKey;
	const combos = [];
	if (typeof bindKey === "object") {
		const pushCombo = (combo) => {
			if (typeof combo === "string" && combo.trim()) combos.push(combo.trim());
		};
		pushCombo(bindKey.win);
		pushCombo(bindKey.linux);
		pushCombo(bindKey.mac);
	}
	return combos.length ? combos.join("|") : null;
}

function applyCommandKeymap(view, bindings = cachedKeymap) {
	if (!view) return;
	view.dispatch({
		effects: commandKeymapCompartment.reconfigure(
			keymap.of(bindings ?? cachedKeymap),
		),
	});
}

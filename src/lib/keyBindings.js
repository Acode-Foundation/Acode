import * as cmCommands from "@codemirror/commands";
import {
	defaultKeymap,
	emacsStyleKeymap,
	historyKeymap,
	indentWithTab,
	standardKeymap,
} from "@codemirror/commands";

const MODIFIER_ORDER = ["Ctrl", "Alt", "Shift", "Cmd"];
const KEYMAP_SOURCES = [
	...standardKeymap,
	...defaultKeymap,
	...historyKeymap,
	...emacsStyleKeymap,
	indentWithTab,
];

const APP_BINDING_CONFIG = [
	{
		name: "focusEditor",
		description: "Focus editor",
		key: "Ctrl-1",
		readOnly: false,
	},
	{
		name: "findFile",
		description: "Find a file",
		key: "Ctrl-P",
		action: "find-file",
	},
	{
		name: "closeCurrentTab",
		description: "Close current tab.",
		key: "Ctrl-Q",
		action: "close-current-tab",
		readOnly: false,
	},
	{
		name: "closeAllTabs",
		description: "Close all tabs.",
		key: "Ctrl-Shift-Q",
		action: "close-all-tabs",
		readOnly: false,
	},
	{
		name: "newFile",
		description: "Create new file",
		key: "Ctrl-N",
		action: "new-file",
		readOnly: true,
	},
	{
		name: "openFile",
		description: "Open a file",
		key: "Ctrl-O",
		action: "open-file",
		readOnly: true,
	},
	{
		name: "openFolder",
		description: "Open a folder",
		key: "Ctrl-Shift-O",
		action: "open-folder",
		readOnly: true,
	},
	{
		name: "saveFile",
		description: "Save current file",
		key: "Ctrl-S",
		action: "save",
		readOnly: true,
		editorOnly: true,
	},
	{
		name: "saveFileAs",
		description: "Save as current file",
		key: "Ctrl-Shift-S",
		action: "save-as",
		readOnly: true,
		editorOnly: true,
	},
	{
		name: "saveAllChanges",
		description: "Save all changes",
		key: null,
		action: "save-all-changes",
		readOnly: true,
	},
	{
		name: "nextFile",
		description: "Open next file tab",
		key: "Ctrl-Tab",
		action: "next-file",
		readOnly: true,
	},
	{
		name: "prevFile",
		description: "Open previous file tab",
		key: "Ctrl-Shift-Tab",
		action: "prev-file",
		readOnly: true,
	},
	{
		name: "showSettingsMenu",
		description: "Show settings menu",
		key: "Ctrl-,",
		readOnly: false,
	},
	{
		name: "renameFile",
		description: "Rename current file",
		key: "F2",
		action: "rename",
		readOnly: true,
		editorOnly: true,
	},
	{
		name: "run",
		description: "Run current file",
		key: "F5",
		action: "run",
		readOnly: false,
		editorOnly: true,
	},
	{
		name: "openInAppBrowser",
		description: "Open in-app browser",
		key: null,
		readOnly: true,
	},
	{
		name: "toggleFullscreen",
		description: "Toggle full screen mode",
		key: "F11",
		action: "toggle-fullscreen",
		readOnly: false,
	},
	{
		name: "toggleSidebar",
		description: "Toggle sidebar",
		key: "Ctrl-B",
		action: "toggle-sidebar",
		readOnly: true,
	},
	{
		name: "toggleMenu",
		description: "Toggle menu",
		key: "F3",
		action: "toggle-menu",
		readOnly: true,
	},
	{
		name: "toggleEditMenu",
		description: "Toggle edit menu",
		key: "F4",
		action: "toggle-editmenu",
		readOnly: true,
	},
	{
		name: "selectall",
		description: "Select all",
		key: "Ctrl-A",
		readOnly: true,
		editorOnly: true,
	},
	{
		name: "gotoline",
		description: "Go to line",
		key: "Ctrl-G",
		readOnly: true,
		editorOnly: true,
	},
	{
		name: "find",
		description: "Find",
		key: "Ctrl-F",
		readOnly: true,
		editorOnly: true,
	},
	{
		name: "copy",
		description: "Copy",
		key: "Ctrl-C",
		readOnly: true,
		editorOnly: true,
	},
	{
		name: "cut",
		description: "Cut",
		key: "Ctrl-X",
		readOnly: false,
		editorOnly: true,
	},
	{
		name: "paste",
		description: "Paste",
		key: "Ctrl-V",
		readOnly: false,
		editorOnly: true,
	},
	{
		name: "problems",
		description: "Show problems",
		key: null,
		readOnly: true,
		editorOnly: true,
	},
	{
		name: "replace",
		description: "Replace",
		key: "Ctrl-R",
		readOnly: false,
		editorOnly: true,
	},
	{
		name: "openCommandPalette",
		description: "Open command palette",
		key: "Ctrl-Shift-P",
		readOnly: true,
	},
	{
		name: "modeSelect",
		description: "Change language mode",
		key: "Ctrl-M",
		readOnly: false,
		editorOnly: true,
	},
	{
		name: "toggleQuickTools",
		description: "Toggle quick tools",
		key: null,
		readOnly: true,
	},
	{
		name: "selectWord",
		description: "Select current word",
		key: "Ctrl-D",
		action: "select-word",
		readOnly: false,
		editorOnly: true,
	},
	{
		name: "openLogFile",
		description: "Open log file",
		key: null,
		action: "open-log-file",
		readOnly: true,
	},
	{
		name: "openPluginsPage",
		description: "Open plugins page",
		key: null,
		readOnly: true,
	},
	{
		name: "openFileExplorer",
		description: "Open file explorer",
		key: null,
		readOnly: true,
	},
	{
		name: "copyDeviceInfo",
		description: "Copy device info",
		key: null,
		action: "copy-device-info",
		readOnly: true,
	},
	{
		name: "changeAppTheme",
		description: "Change app theme",
		key: null,
		action: "change-app-theme",
		readOnly: true,
	},
	{
		name: "changeEditorTheme",
		description: "Change editor theme",
		key: null,
		action: "change-editor-theme",
		readOnly: true,
	},
	{
		name: "openTerminal",
		description: "Open terminal",
		key: "Ctrl-`",
		action: "new-terminal",
		readOnly: true,
	},
	{
		name: "documentSymbols",
		description: "Go to symbol in document",
		key: null,
		readOnly: true,
		editorOnly: true,
	},
	{
		name: "duplicateSelection",
		description: "Duplicate selection",
		key: "Ctrl-Shift-D",
		readOnly: false,
		editorOnly: true,
	},
	{
		name: "copylinesdown",
		description: "Copy lines down",
		key: "Alt-Shift-Down",
		readOnly: false,
		editorOnly: true,
	},
	{
		name: "copylinesup",
		description: "Copy lines up",
		key: "Alt-Shift-Up",
		readOnly: false,
		editorOnly: true,
	},
	{
		name: "movelinesdown",
		description: "Move lines down",
		key: "Alt-Down",
		readOnly: false,
		editorOnly: true,
	},
	{
		name: "movelinesup",
		description: "Move lines up",
		key: "Alt-Up",
		readOnly: false,
		editorOnly: true,
	},
	{
		name: "removeline",
		description: "Remove line",
		key: null,
		readOnly: false,
		editorOnly: true,
	},
	{
		name: "insertlineafter",
		description: "Insert line after",
		key: null,
		readOnly: false,
		editorOnly: true,
	},
	{
		name: "selectline",
		description: "Select line",
		key: null,
		readOnly: true,
		editorOnly: true,
	},
	{
		name: "selectlinesdown",
		description: "Select lines down",
		key: null,
		readOnly: true,
		editorOnly: true,
	},
	{
		name: "selectlinesup",
		description: "Select lines up",
		key: null,
		readOnly: true,
		editorOnly: true,
	},
	{
		name: "selectlinestart",
		description: "Select line start",
		key: "Shift-Home",
		readOnly: true,
		editorOnly: true,
	},
	{
		name: "selectlineend",
		description: "Select line end",
		key: "Shift-End",
		readOnly: true,
		editorOnly: true,
	},
	{
		name: "indent",
		description: "Indent",
		key: "Tab",
		readOnly: false,
		editorOnly: true,
	},
	{
		name: "outdent",
		description: "Outdent",
		key: "Shift-Tab",
		readOnly: false,
		editorOnly: true,
	},
	{
		name: "indentselection",
		description: "Indent selection",
		key: null,
		readOnly: false,
		editorOnly: true,
	},
	{
		name: "newline",
		description: "Insert newline",
		key: null,
		readOnly: false,
		editorOnly: true,
	},
	{
		name: "joinlines",
		description: "Join lines",
		key: null,
		readOnly: false,
		editorOnly: true,
	},
	{
		name: "deletetolinestart",
		description: "Delete to line start",
		key: null,
		readOnly: false,
		editorOnly: true,
	},
	{
		name: "deletetolineend",
		description: "Delete to line end",
		key: null,
		readOnly: false,
		editorOnly: true,
	},
	{
		name: "togglecomment",
		description: "Toggle comment",
		key: "Ctrl-/",
		readOnly: false,
		editorOnly: true,
	},
	{
		name: "comment",
		description: "Add line comment",
		key: null,
		readOnly: false,
		editorOnly: true,
	},
	{
		name: "uncomment",
		description: "Remove line comment",
		key: null,
		readOnly: false,
		editorOnly: true,
	},
	{
		name: "toggleBlockComment",
		description: "Toggle block comment",
		key: "Ctrl-Shift-/",
		readOnly: false,
		editorOnly: true,
	},
	{
		name: "undo",
		description: "Undo",
		key: "Ctrl-Z",
		readOnly: false,
		editorOnly: true,
	},
	{
		name: "redo",
		description: "Redo",
		key: "Ctrl-Shift-Z|Ctrl-Y",
		readOnly: false,
		editorOnly: true,
	},
	{
		name: "simplifySelection",
		description: "Simplify selection",
		key: null,
		readOnly: true,
		editorOnly: true,
	},
];

const APP_KEY_BINDINGS = buildAppBindings(APP_BINDING_CONFIG);
const APP_CUSTOM_COMMANDS = new Set(
	APP_BINDING_CONFIG.filter((config) => !config.action).map(
		(config) => config.name,
	),
);

const FORCE_READ_ONLY = new Set([
	"toggleTabFocusMode",
	"temporarilySetTabFocusMode",
]);
const MUTATING_COMMAND_PATTERN =
	/^(delete|insert|indent|move|copy|split|transpose|toggle|undo|redo|line|block)/i;

const CODEMIRROR_COMMAND_NAMES = new Set(
	Object.entries(cmCommands)
		.filter(([, value]) => typeof value === "function")
		.map(([name]) => name),
);

const CODEMIRROR_KEY_BINDINGS = buildCodemirrorKeyBindings(APP_KEY_BINDINGS);

const keyBindings = Object.fromEntries(
	Object.entries({ ...CODEMIRROR_KEY_BINDINGS, ...APP_KEY_BINDINGS })
		.filter(
			([name, binding]) =>
				binding &&
				(binding.action ||
					APP_CUSTOM_COMMANDS.has(name) ||
					CODEMIRROR_COMMAND_NAMES.has(name)),
		)
		.sort((a, b) => a[0].localeCompare(b[0])),
);

export default keyBindings;

function buildAppBindings(configs) {
	return Object.fromEntries(
		configs.map(
			({
				name,
				description,
				key = null,
				action,
				readOnly = true,
				editorOnly,
			}) => [
				name,
				{
					description: description ?? humanizeCommandName(name),
					key,
					readOnly,
					...(editorOnly !== undefined ? { editorOnly } : {}),
					...(action ? { action } : {}),
				},
			],
		),
	);
}

function buildCodemirrorKeyBindings(appBindings) {
	const commandEntries = Object.entries(cmCommands).filter(
		([, value]) => typeof value === "function",
	);
	const commandNameByFunction = new Map(
		commandEntries.map(([name, fn]) => [fn, name]),
	);
	const comboMap = new Map();

	for (const binding of KEYMAP_SOURCES) {
		const baseCombos = new Set();

		pushCommandCombo(binding.run, binding.key, "win", baseCombos);
		pushCommandCombo(binding.run, binding.win, "win", baseCombos);
		pushCommandCombo(binding.run, binding.linux, "win", baseCombos);
		pushCommandCombo(binding.run, binding.mac, "mac", baseCombos);

		if (binding.shift) {
			const shiftName = commandNameByFunction.get(binding.shift);
			if (shiftName && !appBindings[shiftName]) {
				const combos = baseCombos.size
					? Array.from(baseCombos)
					: [
							normalizeKey(binding.key, "win"),
							normalizeKey(binding.win, "win"),
							normalizeKey(binding.linux, "win"),
							normalizeKey(binding.mac, "mac"),
						].filter(Boolean);
				for (const combo of combos) {
					addCommandCombo(comboMap, shiftName, ensureModifier(combo, "Shift"));
				}
			}
		}
	}

	const result = {};
	for (const [name, combos] of comboMap.entries()) {
		if (!combos.size || appBindings[name]) continue;
		result[name] = {
			description: humanizeCommandName(name),
			key: Array.from(combos)
				.sort((a, b) => a.localeCompare(b))
				.join("|"),
			readOnly: inferReadOnly(name),
			editorOnly: true,
		};
	}
	return result;

	function pushCommandCombo(commandFn, key, platform, baseCombos) {
		if (!commandFn) return;
		const name = commandNameByFunction.get(commandFn);
		if (!name || appBindings[name]) return;
		const normalized = normalizeKey(key, platform);
		if (!normalized) return;
		addCommandCombo(comboMap, name, normalized);
		baseCombos.add(normalized);
	}
}

function addCommandCombo(map, name, combo) {
	if (!combo) return;
	let entry = map.get(name);
	if (!entry) {
		entry = new Set();
		map.set(name, entry);
	}
	entry.add(combo);
}

function normalizeKey(key, platform = "win") {
	if (!key) return null;
	const replaced = key.replace(/Mod/g, platform === "mac" ? "Cmd" : "Ctrl");
	const { modifiers, baseKey } = parseKeyParts(replaced);
	if (!baseKey) return [...modifiers].join("-") || null;
	const ordered = MODIFIER_ORDER.filter((mod) => modifiers.has(mod));
	return [...ordered, baseKey].join("-");
}

function ensureModifier(combo, modifier) {
	if (!combo) return null;
	const { modifiers, baseKey } = parseKeyParts(combo);
	if (!baseKey) return combo;
	modifiers.add(modifier);
	const ordered = MODIFIER_ORDER.filter((mod) => modifiers.has(mod));
	return [...ordered, baseKey].join("-");
}

function parseKeyParts(combo) {
	const modifiers = new Set();
	let baseKey = "";
	if (!combo) return { modifiers, baseKey };
	for (const rawPart of combo.split("-")) {
		const part = rawPart.trim();
		if (!part) continue;
		const normalized = part.charAt(0).toUpperCase() + part.slice(1);
		if (MODIFIER_ORDER.includes(normalized)) {
			modifiers.add(normalized);
		} else {
			baseKey = part;
		}
	}
	return { modifiers, baseKey };
}

function humanizeCommandName(name) {
	return name
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replace(/_/g, " ")
		.replace(/^./, (char) => char.toUpperCase());
}

function inferReadOnly(name) {
	if (FORCE_READ_ONLY.has(name)) return true;
	return !MUTATING_COMMAND_PATTERN.test(name);
}

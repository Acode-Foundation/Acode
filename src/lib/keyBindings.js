export default {
	focusEditor: {
		description: "Focus editor",
		key: "Ctrl-1",
		readOnly: false,
	},
	copy: {
		description: "Copy",
		key: "Ctrl-C",
		readOnly: true,
	},
	cut: {
		description: "Cut",
		key: "Ctrl-X",
		readOnly: false,
	},
	paste: {
		description: "Paste",
		key: "Ctrl-V",
		readOnly: false,
	},
	findFile: {
		description: "Find a file",
		key: "Ctrl-P",
		action: "find-file",
	},
	closeCurrentTab: {
		description: "Close current tab.",
		key: "Ctrl-Q",
		readOnly: false,
		action: "close-current-tab",
	},
	closeAllTabs: {
		description: "Close all tabs.",
		key: "Ctrl-Shift-Q",
		readOnly: false,
		action: "close-all-tabs",
	},
	newFile: {
		description: "Create new file",
		key: "Ctrl-N",
		readOnly: true,
		action: "new-file",
	},
	openFile: {
		description: "Open a file",
		key: "Ctrl-O",
		readOnly: true,
		action: "open-file",
	},
	openFolder: {
		description: "Open a folder",
		key: "Ctrl-Shift-O",
		readOnly: true,
		action: "open-folder",
	},
	saveFile: {
		description: "Save current file",
		key: "Ctrl-S",
		readOnly: true,
		action: "save",
	},
	saveFileAs: {
		description: "Save as current file",
		key: "Ctrl-Shift-S",
		readOnly: true,
		action: "save-as",
	},
	nextFile: {
		description: "Open next file tab",
		key: "Ctrl-Tab",
		readOnly: true,
		action: "next-file",
	},
	prevFile: {
		description: "Open previous file tab",
		key: "Ctrl-Shift-Tab",
		readOnly: true,
		action: "prev-file",
	},
	renameFile: {
		description: "Rename current file",
		key: "F2",
		readOnly: true,
		action: "rename",
	},
	run: {
		description: "Run current file",
		key: "F5",
		readOnly: false,
		action: "run",
	},
	selectWord: {
		description: "Select current word",
		key: "Ctrl-D",
		readOnly: false,
		action: "select-word",
	},
	autoindent: {
		key: null,
		description: "Auto indentation",
		readOnly: false,
	},
	showSettingsMenu: {
		key: "Ctrl-,",
		description: "Show settings menu",
		readOnly: false,
	},
	toggleFullscreen: {
		key: "F11",
		description: "Toggle full screen mode",
		readOnly: false,
		action: "toggle-fullscreen",
	},
	toggleSidebar: {
		key: "Ctrl-B",
		description: "Toggle sidebar",
		readOnly: true,
		action: "toggle-sidebar",
	},
	toggleMenu: {
		key: "F3",
		description: "Toggle edit menu",
		readOnly: true,
		action: "toggle-menu",
	},
	toggleEditMenu: {
		key: "F4",
		description: "Toggle edit menu",
		readOnly: true,
		action: "toggle-editmenu",
	},
	goToNextError: {
		key: "Alt-E",
		description: "Go to next error",
		readOnly: false,
	},
	goToPreviousError: {
		key: "Alt-Shift-E",
		description: "Go to previous error",
		readOnly: false,
	},
	selectall: {
		description: "Select all",
		key: "Ctrl-A",
		readOnly: true,
	},
	centerselection: {
		description: "Center selection",
		key: null,
		readOnly: false,
	},
	gotoline: {
		description: "Go to line...",
		key: "Ctrl-G",
		readOnly: true,
	},
	fold: {
		description: "Fold",
		key: "Alt-L|Ctrl-F1",
		readOnly: false,
	},
	unfold: {
		description: "Unfold",
		key: "Alt-Shift-L|Ctrl-Shift-F1",
		readOnly: false,
	},
	toggleFoldWidget: {
		key: null,
		readOnly: false,
	},
	toggleParentFoldWidget: {
		key: "Alt-F2",
		readOnly: false,
	},
	foldall: {
		description: "Fold all",
		key: null,
		readOnly: false,
	},
	foldOther: {
		description: "Fold other",
		key: "Alt-0",
		readOnly: false,
	},
	unfoldall: {
		description: "Unfold all",
		key: "Alt-Shift-0",
		readOnly: false,
	},
	findnext: {
		description: "Find next",
		key: "Ctrl-K",
		readOnly: false,
	},
	findprevious: {
		description: "Find previous",
		key: "Ctrl-Shift-X",
		readOnly: false,
	},
	selectOrFindNext: {
		description: "Select or find next",
		key: "Alt-K",
		readOnly: false,
	},
	selectOrFindPrevious: {
		description: "Select or find previous",
		key: "Alt-Shift-K",
		readOnly: false,
	},
	find: {
		description: "Find",
		key: "Ctrl-F",
		readOnly: true,
	},
	overwrite: {
		description: "Overwrite",
		key: "Insert",
		readOnly: true,
	},
	selecttostart: {
		description: "Select to start",
		key: "Ctrl-Shift-Home",
		readOnly: true,
	},
	gotostart: {
		description: "Go to start",
		key: "Ctrl-Home",
		readOnly: true,
	},
	selectup: {
		description: "Select up",
		key: "Shift-Up",
		readOnly: true,
	},
	golineup: {
		description: "Go line up",
		key: "Up",
		readOnly: true,
	},
	selecttoend: {
		description: "Select to end",
		key: "Ctrl-Shift-End",
		readOnly: true,
	},
	gotoend: {
		description: "Go to end",
		key: "Ctrl-End",
		readOnly: true,
	},
	selectdown: {
		description: "Select down",
		key: "Shift-Down",
		readOnly: true,
	},
	golinedown: {
		description: "Go line down",
		key: "Down",
		readOnly: true,
	},
	selectwordleft: {
		description: "Select word left",
		key: "Ctrl-Shift-Left",
		readOnly: true,
	},
	gotowordleft: {
		description: "Go to word left",
		key: "Ctrl-Left",
		readOnly: true,
	},
	selecttolinestart: {
		description: "Select to line start",
		key: "Alt-Shift-Left",
		readOnly: true,
	},
	gotolinestart: {
		description: "Go to line start",
		key: "Alt-Left|Home",
		readOnly: true,
	},
	selectleft: {
		description: "Select left",
		key: "Shift-Left",
		readOnly: true,
	},
	gotoleft: {
		description: "Go to left",
		key: "Left",
		readOnly: true,
	},
	selectwordright: {
		description: "Select word right",
		key: "Ctrl-Shift-Right",
		readOnly: true,
	},
	gotowordright: {
		description: "Go to word right",
		key: "Ctrl-Right",
		readOnly: true,
	},
	selecttolineend: {
		description: "Select to line end",
		key: "Alt-Shift-Right",
		readOnly: true,
	},
	gotolineend: {
		description: "Go to line end",
		key: "Alt-Right|End",
		readOnly: true,
	},
	selectright: {
		description: "Select right",
		key: "Shift-Right",
		readOnly: true,
	},
	gotoright: {
		description: "Go to right",
		key: "Right",
		readOnly: true,
	},
	selectpagedown: {
		description: "Select page down",
		key: "Shift-PageDown",
		readOnly: true,
	},
	pagedown: {
		description: "Page down",
		key: null,
		readOnly: true,
	},
	gotopagedown: {
		description: "Go to page down",
		key: "PageDown",
		readOnly: false,
	},
	selectpageup: {
		description: "Select page up",
		key: "Shift-PageUp",
		readOnly: true,
	},
	pageup: {
		description: "Page up",
		key: null,
		readOnly: false,
	},
	problems: {
		description: "Show problems",
		key: "Ctrl-Shift-K",
		readOnly: true,
	},
	gotopageup: {
		description: "Go to page up",
		key: "PageUp",
		readOnly: true,
	},
	scrollup: {
		description: "Scroll up",
		key: "Ctrl-Up",
		readOnly: true,
	},
	scrolldown: {
		description: "Scroll down",
		key: "Ctrl-Down",
		readOnly: true,
	},
	selectlinestart: {
		description: "Select line start",
		key: "Shift-Home",
		readOnly: true,
	},
	selectlineend: {
		description: "Select line end",
		key: "Shift-End",
		readOnly: true,
	},
	togglerecording: {
		description: "Toggle recording",
		key: "Ctrl-Alt-E",
		readOnly: true,
	},
	replaymacro: {
		description: "Replay macro",
		key: "Ctrl-Shift-E",
		readOnly: true,
	},
	jumptomatching: {
		description: "Jump to matching",
		key: "Ctrl-\\",
		readOnly: true,
	},
	selecttomatching: {
		description: "Select to matching",
		key: "Ctrl-Shift-\\",
		readOnly: false,
	},
	expandToMatching: {
		description: "Expand to matching",
		key: "Ctrl-Shift-M",
		readOnly: false,
	},
	removeline: {
		description: "Remove line",
		key: null,
		readOnly: false,
	},
	duplicateSelection: {
		description: "Duplicate selection",
		key: "Ctrl-Shift-D",
		readOnly: false,
	},
	sortlines: {
		description: "Sort lines",
		key: "Ctrl-Alt-S",
		readOnly: false,
	},
	togglecomment: {
		description: "Toggle comment",
		key: "Ctrl-/",
		readOnly: false,
	},
	toggleBlockComment: {
		description: "Toggle block comment",
		key: "Ctrl-Shift-/",
		readOnly: false,
	},
	modifyNumberUp: {
		description: "Modify number up",
		key: "Ctrl-Shift-Up",
		readOnly: false,
	},
	modifyNumberDown: {
		description: "Modify number down",
		key: "Ctrl-Shift-Down",
		readOnly: false,
	},
	replace: {
		description: "Replace",
		key: "Ctrl-R",
		readOnly: false,
	},
	undo: {
		description: "Undo",
		key: "Ctrl-Z",
		readOnly: false,
	},
	redo: {
		description: "Redo",
		key: "Ctrl-Shift-Z|Ctrl-Y",
		readOnly: false,
	},
	copylinesup: {
		description: "Copy lines up",
		key: "Alt-Shift-Up",
		readOnly: false,
	},
	movelinesup: {
		description: "Move lines up",
		key: "Alt-Up",
		readOnly: false,
	},
	copylinesdown: {
		description: "Copy lines down",
		key: "Alt-Shift-Down",
		readOnly: false,
	},
	movelinesdown: {
		description: "Move lines down",
		key: "Alt-Down",
		readOnly: false,
	},
	del: {
		description: "Delete",
		key: "Delete",
		readOnly: true,
	},
	backspace: {
		description: "Backspace",
		key: "Shift-Backspace|Backspace",
		readOnly: false,
	},
	cut_or_delete: {
		description: "Cut or delete",
		key: "Shift-Delete",
		readOnly: false,
	},
	removetolinestart: {
		description: "Remove to line start",
		key: "Alt-Backspace",
		readOnly: false,
	},
	removetolineend: {
		description: "Remove to line end",
		key: "Alt-Delete",
		readOnly: false,
	},
	removetolinestarthard: {
		description: "Remove to line start hard",
		key: "Ctrl-Shift-Backspace",
		readOnly: false,
	},
	removetolineendhard: {
		description: "Remove to line end hard",
		key: "Ctrl-Shift-Delete",
		readOnly: false,
	},
	removewordleft: {
		description: "Remove word left",
		key: "Ctrl-Backspace",
		readOnly: false,
	},
	removewordright: {
		description: "Remove word right",
		key: "Ctrl-Delete",
		readOnly: false,
	},
	outdent: {
		description: "Outdent",
		key: "Shift-Tab",
		readOnly: false,
	},
	indent: {
		description: "Indent",
		key: "Tab",
		readOnly: true,
	},
	blockoutdent: {
		description: "Block outdent",
		key: "Ctrl-[",
		readOnly: false,
	},
	blockindent: {
		description: "Block indent",
		key: "Ctrl-]",
		readOnly: false,
	},
	splitline: {
		description: "Split line",
		key: null,
		readOnly: false,
	},
	transposeletters: {
		description: "Transpose letters",
		key: "Alt-Shift-X",
		readOnly: false,
	},
	touppercase: {
		description: "To uppercase",
		key: "Ctrl-U",
		readOnly: false,
	},
	tolowercase: {
		description: "To lowercase",
		key: "Ctrl-Shift-U",
		readOnly: false,
	},
	expandtoline: {
		description: "Expand to line",
		key: "Ctrl-Shift-L",
		readOnly: true,
	},
	joinlines: {
		description: "Join lines",
		key: null,
		readOnly: false,
	},
	invertSelection: {
		description: "Invert selection",
		key: null,
		readOnly: false,
	},
	openCommandPalette: {
		description: "Open command palette",
		key: "Ctrl-Shift-P",
		readOnly: true,
	},
	modeSelect: {
		description: "Change language mode",
		key: "Ctrl-M",
		readOnly: false,
	},
	increaseFontSize: {
		description: "Increase font size",
		key: "Ctrl-+|Ctrl-=",
	},
	decreaseFontSize: {
		description: "Decrease font size",
		key: "Ctrl+-|Ctrl-_",
	},
	resetFontSize: {
		description: "Reset font size",
		key: "Ctrl+0|Ctrl-Numpad0",
	},
};

import {
	cursorCharLeft,
	cursorCharRight,
	cursorDocEnd,
	cursorDocStart,
	cursorGroupLeft,
	cursorGroupRight,
	cursorLineBoundaryBackward,
	cursorLineBoundaryForward,
	cursorLineDown,
	cursorLineUp,
	cursorPageDown,
	cursorPageUp,
	deleteCharBackward,
	deleteCharForward,
	deleteGroupBackward,
	deleteGroupForward,
	deleteLineBoundaryBackward,
	deleteLineBoundaryForward,
	selectCharLeft,
	selectCharRight,
	selectDocEnd,
	selectDocStart,
	selectGroupLeft,
	selectGroupRight,
	selectLineBoundaryBackward,
	selectLineBoundaryForward,
	selectLineDown,
	selectLineUp,
	selectPageDown,
	selectPageUp,
} from "@codemirror/commands";
import {
	type Command,
	type EditorView as CodeMirrorEditorView,
	runScopeHandlers,
} from "@codemirror/view";
import createKeyboardEvent from "utils/keyboardEvent";

interface QuickToolKeyModifiers {
	shiftKey?: boolean;
	ctrlKey?: boolean;
	altKey?: boolean;
	metaKey?: boolean;
}

const keyNames: Record<number, string> = {
	8: "Backspace",
	9: "Tab",
	13: "Enter",
	27: "Escape",
	33: "PageUp",
	34: "PageDown",
	35: "End",
	36: "Home",
	37: "ArrowLeft",
	38: "ArrowUp",
	39: "ArrowRight",
	40: "ArrowDown",
	46: "Delete",
};

const plainMovementCommands: Record<number, Command> = {
	37: cursorCharLeft,
	38: cursorLineUp,
	39: cursorCharRight,
	40: cursorLineDown,
	33: cursorPageUp,
	34: cursorPageDown,
	35: cursorLineBoundaryForward,
	36: cursorLineBoundaryBackward,
};

const shiftMovementCommands: Record<number, Command> = {
	37: selectCharLeft,
	38: selectLineUp,
	39: selectCharRight,
	40: selectLineDown,
	33: selectPageUp,
	34: selectPageDown,
	35: selectLineBoundaryForward,
	36: selectLineBoundaryBackward,
};

const ctrlMovementCommands: Record<number, Command> = {
	37: cursorGroupLeft,
	38: cursorPageUp,
	39: cursorGroupRight,
	40: cursorPageDown,
	35: cursorDocEnd,
	36: cursorDocStart,
};

const ctrlShiftMovementCommands: Record<number, Command> = {
	37: selectGroupLeft,
	38: selectPageUp,
	39: selectGroupRight,
	40: selectPageDown,
	35: selectDocEnd,
	36: selectDocStart,
};

const metaMovementCommands: Record<number, Command> = {
	37: cursorLineBoundaryBackward,
	38: cursorDocStart,
	39: cursorLineBoundaryForward,
	40: cursorDocEnd,
	35: cursorDocEnd,
	36: cursorDocStart,
};

const metaShiftMovementCommands: Record<number, Command> = {
	37: selectLineBoundaryBackward,
	38: selectDocStart,
	39: selectLineBoundaryForward,
	40: selectDocEnd,
	35: selectDocEnd,
	36: selectDocStart,
};

export function createQuickToolKeyEvent(
	keyCode: number,
	modifiers: QuickToolKeyModifiers = {},
): KeyboardEvent {
	const key = keyNames[keyCode] || String.fromCharCode(keyCode);
	return createKeyboardEvent("keydown", {
		type: "keydown",
		key,
		keyCode,
		which: keyCode,
		bubbles: true,
		cancelable: true,
		shiftKey: !!modifiers.shiftKey,
		ctrlKey: !!modifiers.ctrlKey,
		altKey: !!modifiers.altKey,
		metaKey: !!modifiers.metaKey,
	}) as KeyboardEvent;
}

export function runQuickToolKey(
	view: CodeMirrorEditorView,
	keyCode: number,
	modifiers: QuickToolKeyModifiers = {},
): boolean {
	if (!view?.state || typeof view.focus !== "function") return false;

	const event = createQuickToolKeyEvent(keyCode, modifiers);
	if (runScopeHandlers(view, event, "editor")) {
		view.focus();
		return true;
	}

	const command = getFallbackCommand(keyCode, modifiers);
	if (!command) return false;
	const handled = command(view);
	if (handled !== false) {
		view.focus();
		return true;
	}

	return false;
}

export const runQuickToolNavigation = runQuickToolKey;

function getFallbackCommand(
	keyCode: number,
	modifiers: QuickToolKeyModifiers = {},
): Command | undefined {
	if (keyCode === 46) return getDeleteForwardCommand(modifiers);
	if (keyCode === 8) return getDeleteBackwardCommand(modifiers);

	if (modifiers.metaKey) {
		return modifiers.shiftKey
			? metaShiftMovementCommands[keyCode]
			: metaMovementCommands[keyCode];
	}

	if (modifiers.ctrlKey || modifiers.altKey) {
		return modifiers.shiftKey
			? ctrlShiftMovementCommands[keyCode]
			: ctrlMovementCommands[keyCode];
	}

	return modifiers.shiftKey
		? shiftMovementCommands[keyCode]
		: plainMovementCommands[keyCode];
}

function getDeleteForwardCommand(
	modifiers: QuickToolKeyModifiers = {},
): Command {
	if (modifiers.metaKey) return deleteLineBoundaryForward;
	if (modifiers.ctrlKey || modifiers.altKey) return deleteGroupForward;
	return deleteCharForward;
}

function getDeleteBackwardCommand(
	modifiers: QuickToolKeyModifiers = {},
): Command {
	if (modifiers.metaKey) return deleteLineBoundaryBackward;
	if (modifiers.ctrlKey || modifiers.altKey) return deleteGroupBackward;
	return deleteCharBackward;
}

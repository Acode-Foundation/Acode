import { EditorSelection } from "@codemirror/state";
import type { BlockInfo, EditorView } from "@codemirror/view";

type LineInfo = Pick<BlockInfo, "from" | "to"> | null | undefined;

type LineNumberClickEvent = Pick<
	MouseEvent,
	| "button"
	| "shiftKey"
	| "altKey"
	| "ctrlKey"
	| "metaKey"
	| "preventDefault"
	| "defaultPrevented"
>;

function toDocumentOffset(
	value: number | null | undefined,
	fallback = 0,
): number {
	const resolved = value != null ? Number(value) : fallback;
	return Number.isFinite(resolved) ? resolved : fallback;
}

/**
 * Resolve the selection range for a clicked document line.
 * Includes the trailing line break when one exists to mirror Ace's
 * full-line selection behavior.
 */
export function getLineSelectionRange(
	state: EditorView["state"],
	line: LineInfo,
): { from: number; to: number } | null {
	if (!line) return null;
	const from = Math.max(0, toDocumentOffset(line.from));
	const to = Math.max(from, toDocumentOffset(line.to, from));
	return {
		from,
		to: Math.min(to + 1, state.doc.length),
	};
}

function getCurrentSelectionLineRange(state: EditorView["state"]): {
	from: number;
	to: number;
} {
	const selection = state.selection.main;
	const startLine = state.doc.lineAt(selection.from);
	const endPos = selection.empty
		? selection.head
		: Math.max(selection.to - 1, selection.from);
	const endLine = state.doc.lineAt(endPos);
	const startRange = getLineSelectionRange(state, startLine);
	const endRange = getLineSelectionRange(state, endLine);

	return {
		from: startRange?.from ?? selection.from,
		to: endRange?.to ?? selection.to,
	};
}

function createLineSelection(range: {
	from: number;
	to: number;
}): EditorSelection {
	return EditorSelection.single(range.to, range.from);
}

function createExtendedLineSelection(
	state: EditorView["state"],
	clickedRange: { from: number; to: number },
): EditorSelection {
	const currentRange = getCurrentSelectionLineRange(state);
	const from = Math.min(currentRange.from, clickedRange.from);
	const to = Math.max(currentRange.to, clickedRange.to);

	if (clickedRange.from <= currentRange.from) {
		return EditorSelection.single(to, from);
	}

	return EditorSelection.single(from, to);
}

/**
 * Select the clicked line from the line-number gutter.
 * Shift-click extends the current selection by whole lines.
 * Other modified or non-primary clicks are ignored so they don't interfere
 * with context menus or alternate selection gestures.
 */
export function handleLineNumberClick(
	view: EditorView | null | undefined,
	line: LineInfo,
	event: LineNumberClickEvent | null | undefined,
): boolean {
	if (!view || !event || event.defaultPrevented) return false;
	if ((event.button ?? 0) !== 0) return false;
	if (event.altKey || event.ctrlKey || event.metaKey) {
		return false;
	}

	const range = getLineSelectionRange(view.state, line);
	if (!range) return false;

	event.preventDefault();
	view.dispatch({
		selection: event.shiftKey
			? createExtendedLineSelection(view.state, range)
			: createLineSelection(range),
		userEvent: event.shiftKey ? "select.extend.pointer" : "select.pointer",
	});
	view.focus();
	return true;
}

export default handleLineNumberClick;

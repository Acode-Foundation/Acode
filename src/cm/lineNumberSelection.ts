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
	const from = Math.max(0, Number(line.from) || 0);
	const to = Math.max(from, Number(line.to) || from);
	return {
		from,
		to: Math.min(to + 1, state.doc.length),
	};
}

/**
 * Select the clicked line from the line-number gutter.
 * Ignores modified and non-primary clicks so it doesn't interfere with
 * context menus or alternate selection gestures.
 */
export function handleLineNumberClick(
	view: EditorView | null | undefined,
	line: LineInfo,
	event: LineNumberClickEvent | null | undefined,
): boolean {
	if (!view || !event || event.defaultPrevented) return false;
	if ((event.button ?? 0) !== 0) return false;
	if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) {
		return false;
	}

	const range = getLineSelectionRange(view.state, line);
	if (!range) return false;

	event.preventDefault();
	view.dispatch({
		selection: EditorSelection.single(range.from, range.to),
		userEvent: "select.pointer",
	});
	view.focus();
	return true;
}

export default handleLineNumberClick;

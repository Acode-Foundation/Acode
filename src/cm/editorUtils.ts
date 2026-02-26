import { foldEffect, foldedRanges } from "@codemirror/language";
import type { EditorState, StateEffect } from "@codemirror/state";
import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

export interface FoldSpan {
	fromLine: number;
	fromCol: number;
	toLine: number;
	toCol: number;
}
export interface SelectionRange {
	from: number;
	to: number;
}
export interface SerializedSelection {
	ranges: SelectionRange[];
	mainIndex: number;
}
export interface ScrollPosition {
	scrollTop: number;
	scrollLeft: number;
}

/**
 * Get all folded ranges from CodeMirror editor state
 */
export function getAllFolds(state: EditorState): FoldSpan[] {
	const doc = state.doc;
	const folds: FoldSpan[] = [];

	foldedRanges(state).between(0, doc.length, (from, to) => {
		const fromPos = doc.lineAt(from);
		const toPos = doc.lineAt(to);
		folds.push({
			fromLine: fromPos.number,
			fromCol: from - fromPos.from,
			toLine: toPos.number,
			toCol: to - toPos.from,
		});
	});

	return folds;
}

/**
 * Get current selection from editor view
 */
export function getSelection(view: EditorView): SerializedSelection {
	const sel = view.state.selection;
	return {
		ranges: sel.ranges.map((r) => ({ from: r.from, to: r.to })),
		mainIndex: sel.mainIndex,
	};
}

/**
 * Get scroll position from editor view
 */
export function getScrollPosition(view: EditorView): ScrollPosition {
	const { scrollTop, scrollLeft } = view.scrollDOM;
	return { scrollTop, scrollLeft };
}

/**
 * Set scroll position in CodeMirror editor view
 */
export function setScrollPosition(
	view: EditorView,
	scrollTop?: number,
	scrollLeft?: number,
): void {
	const scroller = view.scrollDOM;

	if (typeof scrollTop === "number") {
		scroller.scrollTop = scrollTop;
	}

	if (typeof scrollLeft === "number") {
		scroller.scrollLeft = scrollLeft;
	}
}

/**
 * Restore selection to editor view
 */
export function restoreSelection(
	view: EditorView,
	sel: SerializedSelection | null | undefined,
): void {
	if (!sel || !sel.ranges || !sel.ranges.length) return;
	const len = view.state.doc.length;

	const ranges = sel.ranges
		.map((r) => {
			const from = Math.max(0, Math.min(len, r.from | 0));
			const to = Math.max(0, Math.min(len, r.to | 0));
			return EditorSelection.range(from, to);
		})
		.filter(Boolean);

	if (!ranges.length) return;

	const mainIndex =
		sel.mainIndex >= 0 && sel.mainIndex < ranges.length ? sel.mainIndex : 0;

	view.dispatch({
		selection: EditorSelection.create(ranges, mainIndex),
		scrollIntoView: true,
	});
}

/**
 * Restore folds to CodeMirror editor
 */
export function restoreFolds(
	view: EditorView,
	folds: FoldSpan[] | null | undefined,
): void {
	if (!Array.isArray(folds) || folds.length === 0) return;

	function lineColToOffset(
		doc: EditorState["doc"],
		line: number,
		col: number,
	): number {
		const ln = doc.line(line);
		return Math.min(ln.from + col, ln.to);
	}

	function loadFolds(
		state: EditorState,
		saved: FoldSpan[],
	): StateEffect<{ from: number; to: number }>[] {
		const doc = state.doc;
		const effects: StateEffect<{ from: number; to: number }>[] = [];

		for (const f of saved) {
			// Validate line numbers
			if (f.fromLine < 1 || f.fromLine > doc.lines) continue;
			if (f.toLine < 1 || f.toLine > doc.lines) continue;

			const from = lineColToOffset(doc, f.fromLine, f.fromCol);
			const to = lineColToOffset(doc, f.toLine, f.toCol);
			if (to > from) {
				effects.push(foldEffect.of({ from, to }));
			}
		}
		return effects;
	}

	const restoreEffects = loadFolds(view.state, folds);
	if (restoreEffects.length) {
		view.dispatch({ effects: restoreEffects });
	}
}

/**
 * Clear selection, keeping only cursor position
 */
export function clearSelection(view: EditorView): void {
	view.dispatch({
		selection: EditorSelection.single(view.state.selection.main.head),
		scrollIntoView: true,
	});
	// Also clear the global DOM selection to prevent native selection handles/menus persisting
	try {
		document.getSelection()?.removeAllRanges();
	} catch (_) {
		// Ignore errors
	}
}

export default {
	getAllFolds,
	getSelection,
	getScrollPosition,
	setScrollPosition,
	restoreSelection,
	restoreFolds,
	clearSelection,
};

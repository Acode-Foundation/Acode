import {
	codeFolding,
	ensureSyntaxTree,
	foldable,
	foldEffect,
	foldedRanges,
	foldState,
	unfoldEffect,
} from "@codemirror/language";
import { StateEffect } from "@codemirror/state";

const FULL_PARSE_BUDGET_MS = 100;

/**
 * Fold every foldable block, including nested blocks. CodeMirror's built-in
 * foldAll intentionally skips nested ranges after finding a top-level fold.
 */
export function foldAllCodeBlocks(view) {
	const { state } = view;
	ensureSyntaxTree(state, state.doc.length, FULL_PARSE_BUDGET_MS);

	const existing = new Set();
	foldedRanges(state).between(0, state.doc.length, (from, to) => {
		existing.add(`${from}:${to}`);
	});

	const effects = [];
	const discovered = new Set();
	for (let lineNumber = 1; lineNumber <= state.doc.lines; lineNumber += 1) {
		const line = state.doc.line(lineNumber);
		const range = foldable(state, line.from, line.to);
		if (!range) continue;

		const id = `${range.from}:${range.to}`;
		if (existing.has(id) || discovered.has(id)) continue;
		discovered.add(id);
		effects.push(foldEffect.of(range));
	}

	if (!effects.length) return false;
	if (!state.field(foldState, false)) {
		// Install the state field first so it can consume the fold effects in
		// the following transaction when folding was disabled in editor settings.
		view.dispatch({ effects: StateEffect.appendConfig.of(codeFolding()) });
	}
	view.dispatch({ effects });
	return true;
}

/** Unfold every stored fold, including nested folds created above. */
export function unfoldAllCodeBlocks(view) {
	const effects = [];
	foldedRanges(view.state).between(0, view.state.doc.length, (from, to) => {
		effects.push(unfoldEffect.of({ from, to }));
	});

	if (!effects.length) return false;
	view.dispatch({ effects });
	return true;
}

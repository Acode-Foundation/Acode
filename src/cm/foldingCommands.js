import {
	codeFolding,
	ensureSyntaxTree,
	foldEffect,
	foldedRanges,
	foldNodeProp,
	foldService,
	foldState,
	syntaxTree,
	unfoldEffect,
} from "@codemirror/language";
import { StateEffect } from "@codemirror/state";

const FULL_PARSE_BUDGET_MS = 100;
const INCOMPLETE_PARSE_MARGIN = 50;

function findServiceFold(state, line) {
	for (const service of state.facet(foldService)) {
		const range = service(state, line.from, line.to);
		if (range) return range;
	}
	return null;
}

function addSyntaxFolds(state, tree, line, addRange) {
	if (!tree || tree.length < line.to) return;

	for (let iter = tree.resolveStack(line.to, 1); iter; iter = iter.next) {
		const node = iter.node;
		if (node.to <= line.to || node.from > line.to) continue;
		const lastChild = node.lastChild;
		if (
			tree.length !== state.doc.length &&
			node.to >= tree.length - INCOMPLETE_PARSE_MARGIN &&
			lastChild?.to === node.to &&
			lastChild.type.isError
		) {
			continue;
		}

		const fold = node.type.prop(foldNodeProp);
		if (!fold) continue;

		const range = fold(node, state);
		if (
			range &&
			range.from >= line.from &&
			range.from <= line.to &&
			range.to > line.to
		) {
			addRange(range);
		}
	}
}

/**
 * Fold every foldable block, including nested blocks. CodeMirror's built-in
 * foldAll intentionally skips nested ranges after finding a top-level fold.
 */
export function foldAllCodeBlocks(view) {
	const { state } = view;
	const tree =
		ensureSyntaxTree(state, state.doc.length, FULL_PARSE_BUDGET_MS) ??
		syntaxTree(state);

	const existing = new Set();
	foldedRanges(state).between(0, state.doc.length, (from, to) => {
		existing.add(`${from}:${to}`);
	});

	const effects = [];
	const discovered = new Set();
	const addRange = (range) => {
		const id = `${range.from}:${range.to}`;
		if (existing.has(id) || discovered.has(id)) return;
		discovered.add(id);
		effects.push(foldEffect.of(range));
	};

	for (let lineNumber = 1; lineNumber <= state.doc.lines; lineNumber += 1) {
		const line = state.doc.line(lineNumber);
		const serviceRange = findServiceFold(state, line);
		if (serviceRange) addRange(serviceRange);
		else addSyntaxFolds(state, tree, line, addRange);
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

import {
	codeFolding,
	ensureSyntaxTree,
	foldEffect,
	foldedRanges,
	foldNodeProp,
	foldService,
	foldState,
	forceParsing,
	language,
	StreamLanguage,
	syntaxTree,
	syntaxTreeAvailable,
	unfoldEffect,
} from "@codemirror/language";
import { StateEffect } from "@codemirror/state";

const INITIAL_PARSE_BUDGET_MS = 12;
const IDLE_PARSE_BUDGET_MS = 10;
const MIN_IDLE_PARSE_BUDGET_MS = 2;
const IDLE_CALLBACK_TIMEOUT_MS = 50;
const pendingFoldAllJobs = new WeakMap();

function findServiceFold(state, line) {
	for (const service of state.facet(foldService)) {
		const range = service(state, line.from, line.to);
		if (range) return range;
	}
	return null;
}

function scheduleIdleWork(callback) {
	if (
		typeof window !== "undefined" &&
		typeof window.requestIdleCallback === "function"
	) {
		return {
			kind: "idle",
			id: window.requestIdleCallback(callback, {
				timeout: IDLE_CALLBACK_TIMEOUT_MS,
			}),
		};
	}

	return {
		kind: "timeout",
		id: setTimeout(() => callback(null), 0),
	};
}

function cancelIdleWork(handle) {
	if (!handle) return;
	if (
		handle.kind === "idle" &&
		typeof window !== "undefined" &&
		typeof window.cancelIdleCallback === "function"
	) {
		window.cancelIdleCallback(handle.id);
	} else {
		clearTimeout(handle.id);
	}
}

function cancelPendingFoldAll(view) {
	const job = pendingFoldAllJobs.get(view);
	if (!job) return;
	job.cancelled = true;
	cancelIdleWork(job.handle);
	pendingFoldAllJobs.delete(view);
}

function getIdleParseBudget(deadline) {
	if (!deadline || typeof deadline.timeRemaining !== "function") {
		return IDLE_PARSE_BUDGET_MS;
	}
	return Math.max(
		MIN_IDLE_PARSE_BUDGET_MS,
		Math.min(IDLE_PARSE_BUDGET_MS, Math.floor(deadline.timeRemaining())),
	);
}

function addSyntaxFolds(state, tree, addRange) {
	if (!tree || tree.length < state.doc.length) return;

	tree.iterate({
		enter(ref) {
			const node = ref.node;
			const fold = node.type.prop(foldNodeProp);
			if (!fold) return;

			const range = fold(node, state);
			if (!range) return;

			const line = state.doc.lineAt(range.from);
			if (range.from <= line.to && range.to > line.to) addRange(range);
		},
	});
}

function collectFoldEffects(state, tree) {
	const existing = new Set();
	foldedRanges(state).between(0, state.doc.length, (from, to) => {
		existing.add(`${from}:${to}`);
	});

	const ranges = [];
	const discovered = new Set();
	const addRange = (range) => {
		const id = `${range.from}:${range.to}`;
		if (existing.has(id) || discovered.has(id)) return;
		discovered.add(id);
		ranges.push(range);
	};

	for (let lineNumber = 1; lineNumber <= state.doc.lines; lineNumber += 1) {
		const line = state.doc.line(lineNumber);
		const serviceRange = findServiceFold(state, line);
		if (serviceRange) addRange(serviceRange);
	}
	addSyntaxFolds(state, tree, addRange);

	return ranges
		.sort((a, b) => a.from - b.from || a.to - b.to)
		.map((range) => foldEffect.of(range));
}

function applyAllFolds(view, tree) {
	const { state } = view;
	const effects = collectFoldEffects(state, tree);
	if (!effects.length) return false;
	if (!state.field(foldState, false)) {
		// Install the state field first so it can consume the fold effects in
		// the following transaction when folding was disabled in editor settings.
		view.dispatch({ effects: StateEffect.appendConfig.of(codeFolding()) });
	}
	view.dispatch({ effects });
	return true;
}

function scheduleProgressiveFoldAll(view, document) {
	const job = {
		cancelled: false,
		document,
		handle: null,
	};
	pendingFoldAllJobs.set(view, job);

	const continueParsing = (deadline) => {
		job.handle = null;
		if (
			job.cancelled ||
			pendingFoldAllJobs.get(view) !== job ||
			view.state.doc !== document
		) {
			pendingFoldAllJobs.delete(view);
			return;
		}

		try {
			const complete =
				syntaxTreeAvailable(view.state, document.length) ||
				forceParsing(view, document.length, getIdleParseBudget(deadline));

			if (complete) {
				pendingFoldAllJobs.delete(view);
				applyAllFolds(view, syntaxTree(view.state));
				return;
			}
		} catch (error) {
			console.error("Failed to finish parsing for Fold all.", error);
			pendingFoldAllJobs.delete(view);
			return;
		}

		job.handle = scheduleIdleWork(continueParsing);
	};

	job.handle = scheduleIdleWork(continueParsing);
}

/**
 * Fold every foldable block, including nested blocks. Small and already-parsed
 * documents fold synchronously. Large documents finish parsing in short idle
 * slices before all ranges are collected in one pass and one transaction.
 */
export function foldAllCodeBlocks(view) {
	cancelPendingFoldAll(view);
	const { state } = view;
	const activeLanguage = state.facet(language);

	if (!activeLanguage || activeLanguage instanceof StreamLanguage) {
		return applyAllFolds(view, syntaxTree(state));
	}

	const tree = ensureSyntaxTree(
		state,
		state.doc.length,
		INITIAL_PARSE_BUDGET_MS,
	);
	if (tree) return applyAllFolds(view, tree);

	scheduleProgressiveFoldAll(view, state.doc);
	return true;
}

/** Unfold every stored fold, including nested folds created above. */
export function unfoldAllCodeBlocks(view) {
	cancelPendingFoldAll(view);
	const effects = [];
	foldedRanges(view.state).between(0, view.state.doc.length, (from, to) => {
		effects.push(unfoldEffect.of({ from, to }));
	});

	if (!effects.length) return false;
	view.dispatch({ effects });
	return true;
}

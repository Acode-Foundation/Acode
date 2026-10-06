// @vitest-environment happy-dom

import { javascript } from "@codemirror/lang-javascript";
import { codeFolding, foldedRanges } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const parsing = vi.hoisted(() => ({
	ensureSyntaxTree: vi.fn(),
	forceParsing: vi.fn(),
	syntaxTreeAvailable: vi.fn(),
}));

vi.mock("@codemirror/language", async (importOriginal) => ({
	...(await importOriginal()),
	ensureSyntaxTree: parsing.ensureSyntaxTree,
	forceParsing: parsing.forceParsing,
	syntaxTreeAvailable: parsing.syntaxTreeAvailable,
}));

const { foldAllCodeBlocks, unfoldAllCodeBlocks } = await import(
	"cm/foldingCommands"
);

function createView() {
	let state = EditorState.create({
		doc: [
			"function outer() {",
			"\tif (ready) {",
			'\t\tconsole.log("ready");',
			"\t}",
			"}",
		].join("\n"),
		extensions: [javascript(), codeFolding()],
	});

	return {
		get state() {
			return state;
		},
		dispatch(spec) {
			state = state.update(spec).state;
		},
	};
}

function countFoldedRanges(state) {
	let count = 0;
	foldedRanges(state).between(0, state.doc.length, () => {
		count += 1;
	});
	return count;
}

describe("progressive Fold all", () => {
	let idleCallbacks;
	let nextIdleId;

	beforeEach(() => {
		idleCallbacks = new Map();
		nextIdleId = 1;
		window.requestIdleCallback = vi.fn((callback) => {
			const id = nextIdleId;
			nextIdleId += 1;
			idleCallbacks.set(id, callback);
			return id;
		});
		window.cancelIdleCallback = vi.fn((id) => {
			idleCallbacks.delete(id);
		});

		parsing.ensureSyntaxTree.mockReset().mockReturnValue(null);
		parsing.forceParsing.mockReset();
		parsing.syntaxTreeAvailable.mockReset().mockReturnValue(false);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	function takeNextIdleCallback() {
		const next = idleCallbacks.entries().next().value;
		expect(next).toBeDefined();
		const [id, callback] = next;
		idleCallbacks.delete(id);
		return callback;
	}

	function runNextIdleCallback() {
		takeNextIdleCallback()({
			didTimeout: false,
			timeRemaining: () => 8,
		});
	}

	it("folds after parsing completes across multiple idle slices", () => {
		const view = createView();
		parsing.forceParsing
			.mockReturnValueOnce(false)
			.mockReturnValueOnce(false)
			.mockReturnValueOnce(true);

		expect(foldAllCodeBlocks(view)).toBe(true);
		expect(countFoldedRanges(view.state)).toBe(0);

		runNextIdleCallback();
		runNextIdleCallback();
		expect(countFoldedRanges(view.state)).toBe(0);

		runNextIdleCallback();
		expect(parsing.forceParsing).toHaveBeenCalledTimes(3);
		expect(countFoldedRanges(view.state)).toBeGreaterThan(0);
		expect(idleCallbacks.size).toBe(0);
	});

	it("cancels pending parsing when the document changes", () => {
		const view = createView();
		parsing.forceParsing.mockReturnValue(false);

		foldAllCodeBlocks(view);
		runNextIdleCallback();
		expect(parsing.forceParsing).toHaveBeenCalledTimes(1);

		view.dispatch({ changes: { from: 0, insert: "// changed\n" } });
		runNextIdleCallback();

		expect(parsing.forceParsing).toHaveBeenCalledTimes(1);
		expect(countFoldedRanges(view.state)).toBe(0);
		expect(idleCallbacks.size).toBe(0);
	});

	it("cancels pending parsing when Unfold all runs", () => {
		const view = createView();
		parsing.forceParsing.mockReturnValue(false);

		foldAllCodeBlocks(view);
		const pendingCallback = takeNextIdleCallback();
		expect(unfoldAllCodeBlocks(view)).toBe(false);

		pendingCallback({
			didTimeout: false,
			timeRemaining: () => 8,
		});

		expect(window.cancelIdleCallback).toHaveBeenCalledTimes(1);
		expect(parsing.forceParsing).not.toHaveBeenCalled();
		expect(countFoldedRanges(view.state)).toBe(0);
		expect(idleCallbacks.size).toBe(0);
	});
});

// @vitest-environment happy-dom

import { EditorState, Text } from "@codemirror/state";
import { NodeType, Parser, Tree } from "@lezer/common";
import { describe, expect, it, vi } from "vitest";
import {
	outerLanguageHighlighters,
	provisionalHighlightRange,
	retainHighlightingDuringControlledPreparation,
	retainMappedHighlighting,
	retainMappedHighlightingWhileParsing,
} from "../../vendor/codemirror-language/src/highlight";
import {
	defineLanguageFacet,
	Language,
	ParseWorker,
	provisionalParseIsCurrent,
	viewportPriorityParsing,
} from "../../vendor/codemirror-language/src/language";

describe("viewport-priority parsing lifecycle", () => {
	it("publishes provisional colors during an active gesture while canonical work yields", () => {
		vi.useFakeTimers();
		let now = 0;
		vi.spyOn(Date, "now").mockImplementation(() => ++now);
		let canonicalAdvances = 0;
		class TestParser extends Parser {
			createParse(
				_input: unknown,
				_fragments: unknown,
				ranges: readonly { from: number; to: number }[],
			) {
				const range = ranges[0];
				return {
					parsedPos: range.from,
					stoppedAt: null as number | null,
					stopAt(pos: number) {
						this.stoppedAt = pos;
					},
					advance() {
						if (!range.from) {
							canonicalAdvances++;
							if (this.stoppedAt === this.parsedPos) return Tree.empty;
							return null;
						}
						return new Tree(NodeType.none, [], [], range.to - range.from);
					},
				};
			}
		}
		const lang = new Language(defineLanguageFacet(), new TestParser());
		const state = EditorState.create({
			doc: "const value = 1;\n".repeat(1000),
			extensions: [
				lang,
				viewportPriorityParsing({ sliceMs: 4, approximate: "outer-language" }),
			],
		});
		const dispatch = vi.fn();
		const view = {
			state,
			viewport: { from: 8000, to: 8200 },
			visibleRanges: [{ from: 8000, to: 8200 }],
			win: { performance: { now: () => ++now } },
			controlledTouchScrollController: { renderCritical: true },
			dispatch,
		};
		const worker = new ParseWorker(
			view as unknown as import("@codemirror/view").EditorView,
		);
		try {
			const before = canonicalAdvances;
			vi.advanceTimersByTime(20);
			expect(worker.viewportTree()).toMatchObject({
				from: state.doc.line(385).from,
				approximate: "outer-language",
			});
			expect(dispatch).toHaveBeenCalled();
			worker.work();
			expect(canonicalAdvances).toBe(before);
		} finally {
			worker.destroy();
			vi.restoreAllMocks();
			vi.useRealTimers();
		}
	});

	it("keeps published colors and finishes stable windows through continuous scrolling", () => {
		vi.useFakeTimers();
		let now = 0;
		vi.spyOn(Date, "now").mockImplementation(() => ++now);
		const starts: number[] = [];
		class SlowParser extends Parser {
			createParse(
				_input: unknown,
				_fragments: unknown,
				ranges: readonly { from: number; to: number }[],
			) {
				const range = ranges[0];
				starts.push(range.from);
				let steps = 0;
				return {
					parsedPos: range.from,
					stoppedAt: null as number | null,
					stopAt(pos: number) {
						this.stoppedAt = pos;
					},
					advance() {
						if (this.stoppedAt === this.parsedPos) return Tree.empty;
						if (!range.from || ++steps < 8) return null;
						return new Tree(NodeType.none, [], [], range.to - range.from);
					},
				};
			}
		}
		const lang = new Language(defineLanguageFacet(), new SlowParser());
		const state = EditorState.create({
			doc: Array.from({ length: 10000 }, (_, index) =>
				index % 997 === 0 ? "x".repeat(100000) : "const value = 1;",
			).join("\n"),
			extensions: [
				lang,
				viewportPriorityParsing({ sliceMs: 4, approximate: "outer-language" }),
			],
		});
		const view = {
			state,
			viewport: { from: state.doc.line(400).from, to: state.doc.line(420).to },
			visibleRanges: [] as { from: number; to: number }[],
			win: { performance: { now: () => ++now } },
			controlledTouchScrollController: { renderCritical: true },
			dispatch: vi.fn(),
		};
		view.visibleRanges = [view.viewport];
		const worker = new ParseWorker(
			view as unknown as import("@codemirror/view").EditorView,
		);
		const move = (line: number) => {
			view.viewport = {
				from: state.doc.line(line).from,
				to: state.doc.line(line + 20).to,
			};
			view.visibleRanges = [view.viewport];
			worker.update({
				view,
				state: view.state,
				startState: view.state,
				viewportChanged: true,
				docChanged: false,
				selectionSet: false,
			} as unknown as import("@codemirror/view").ViewUpdate);
		};
		try {
			const first = worker.provisional;
			for (let line = 401; line < 409; line++) {
				move(line);
				vi.advanceTimersByTime(16);
			}
			expect(starts.filter((from) => from === first!.from)).toHaveLength(1);
			expect(worker.viewportTree()?.tree).toBe(first!.tree);
			const published = first!.tree;
			move(500); // Cross a window boundary while the replacement is still running.
			expect(
				worker.viewportTrees().some((tree) => tree.tree === published),
			).toBe(true);
			vi.advanceTimersByTime(500);
			expect(
				worker
					.viewportTrees()
					.some((tree) => tree.to >= state.doc.line(700).to),
			).toBe(true);
			move(400); // Reverse direction without throwing away the original colors.
			expect(worker.viewportTree()?.tree).toBe(published);
			for (let line = 1000; line < 8000; line += 500) {
				move(line);
				vi.advanceTimersByTime(500);
				expect(worker.viewportTrees().length).toBeLessThanOrEqual(12);
				expect(worker.provisionalPending()).toBe(false);
			}
			const previous = view.state;
			view.state = view.state.update({
				changes: { from: 0, insert: "// edit\n" },
			}).state;
			worker.update({
				view,
				state: view.state,
				startState: previous,
				viewportChanged: false,
				docChanged: true,
				selectionSet: false,
			} as unknown as import("@codemirror/view").ViewUpdate);
			expect(worker.viewportTrees()).toEqual([]);
		} finally {
			worker.destroy();
			vi.restoreAllMocks();
			vi.useRealTimers();
		}
	});

	it("rejects stale, edited, language-changed, and destroyed work", () => {
		const doc = Text.of(["const value = 1"]);
		const otherDoc = Text.of(["const value = 2"]);
		const parser = { advance: () => null, parsedPos: 0, stopAt: () => {} };
		const language = {} as Language;
		const task = {
			generation: 4,
			doc,
			language,
			from: 0,
			to: doc.length,
			parse: parser,
			tree: null,
			published: false,
			failed: false,
		};

		expect(provisionalParseIsCurrent(task, 4, doc, language, false)).toBe(true);
		expect(provisionalParseIsCurrent(task, 5, doc, language, false)).toBe(
			false,
		);
		expect(provisionalParseIsCurrent(task, 4, otherDoc, language, false)).toBe(
			false,
		);
		expect(provisionalParseIsCurrent(task, 4, doc, {} as Language, false)).toBe(
			false,
		);
		expect(provisionalParseIsCurrent(task, 4, doc, language, true)).toBe(false);
	});

	it("hands uncovered ranges to provisional highlighting only until exact coverage", () => {
		expect(provisionalHighlightRange(100, 200, 140, 100, 200)).toEqual({
			from: 140,
			to: 200,
		});
		expect(provisionalHighlightRange(100, 200, 200, 100, 200)).toBeNull();
	});

	it("limits provisional styling to the outer language scope", () => {
		const outer = NodeType.define({ id: 1, name: "Outer" });
		const embedded = NodeType.define({ id: 2, name: "Embedded" });
		const provisional = {
			tree: new Tree(outer, [], [], 10),
			from: 0,
			to: 10,
			version: 1,
			approximate: "outer-language" as const,
		};
		const [highlighter] = outerLanguageHighlighters(provisional, [
			{ style: () => "token", scope: () => true },
		]);

		expect(highlighter.scope?.(outer)).toBe(true);
		expect(highlighter.scope?.(embedded)).toBe(false);
	});

	it("retains mapped colors only for covered same-language edits", () => {
		expect(
			retainMappedHighlighting(
				true,
				true,
				false,
				true,
				false,
				100,
				1000,
				2000,
				900,
				2100,
			),
		).toBe(true);
		expect(
			retainMappedHighlighting(
				true,
				true,
				false,
				false,
				false,
				100,
				1000,
				2000,
				900,
				2100,
			),
		).toBe(false);
		expect(
			retainMappedHighlighting(
				true,
				true,
				false,
				true,
				false,
				2000,
				1000,
				2000,
				900,
				2100,
			),
		).toBe(false);
	});

	it("keeps mapped colors through incomplete canonical progress", () => {
		expect(
			retainMappedHighlightingWhileParsing(
				true,
				false,
				true,
				false,
				false,
				false,
				500,
				1000,
				2000,
				900,
				2100,
			),
		).toBe(true);
		expect(
			retainMappedHighlightingWhileParsing(
				true,
				false,
				true,
				false,
				true,
				false,
				500,
				1000,
				2000,
				900,
				2100,
			),
		).toBe(false);
		expect(
			retainMappedHighlightingWhileParsing(
				true,
				false,
				true,
				false,
				false,
				false,
				2000,
				1000,
				2000,
				900,
				2100,
			),
		).toBe(false);
		expect(
			retainMappedHighlightingWhileParsing(
				true,
				false,
				true,
				false,
				false,
				true,
				500,
				1000,
				2000,
				900,
				2100,
			),
		).toBe(false);
	});

	it("retains the colored safe range while a controlled corridor expands", () => {
		expect(
			retainHighlightingDuringControlledPreparation(
				true,
				true,
				true,
				false,
				false,
				false,
				500,
				2000,
			),
		).toBe(true);
		expect(
			retainHighlightingDuringControlledPreparation(
				true,
				true,
				true,
				false,
				true,
				false,
				500,
				2000,
			),
		).toBe(false);
		expect(
			retainHighlightingDuringControlledPreparation(
				true,
				true,
				true,
				false,
				false,
				false,
				2000,
				2000,
			),
		).toBe(false);
	});
});

// @vitest-environment happy-dom

import { Text } from "@codemirror/state";
import { Language } from "../../vendor/codemirror-language/src/language";
import {
	outerLanguageHighlighters,
	provisionalHighlightRange,
	retainHighlightingDuringControlledPreparation,
	retainMappedHighlighting,
	retainMappedHighlightingWhileParsing,
} from "../../vendor/codemirror-language/src/highlight";
import { provisionalParseIsCurrent } from "../../vendor/codemirror-language/src/language";
import { NodeType, Tree } from "@lezer/common";
import { describe, expect, it } from "vitest";

describe("viewport-priority parsing lifecycle", () => {
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

		expect(provisionalParseIsCurrent(task, 4, doc, language, false)).toBe(
			true,
		);
		expect(provisionalParseIsCurrent(task, 5, doc, language, false)).toBe(
			false,
		);
		expect(provisionalParseIsCurrent(task, 4, otherDoc, language, false)).toBe(
			false,
		);
		expect(provisionalParseIsCurrent(task, 4, doc, {} as Language, false)).toBe(
			false,
		);
		expect(provisionalParseIsCurrent(task, 4, doc, language, true)).toBe(
			false,
		);
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
				true, false, true, false, false, false, 500, 1000, 2000, 900, 2100,
			),
		).toBe(true);
		expect(
			retainMappedHighlightingWhileParsing(
				true, false, true, false, true, false, 500, 1000, 2000, 900, 2100,
			),
		).toBe(false);
		expect(
			retainMappedHighlightingWhileParsing(
				true, false, true, false, false, false, 2000, 1000, 2000, 900, 2100,
			),
		).toBe(false);
		expect(
			retainMappedHighlightingWhileParsing(
				true, false, true, false, false, true, 500, 1000, 2000, 900, 2100,
			),
		).toBe(false);
	});

	it("retains the colored safe range while a controlled corridor expands", () => {
		expect(
			retainHighlightingDuringControlledPreparation(
				true, true, true, false, false, false, 500, 2000,
			),
		).toBe(true);
		expect(
			retainHighlightingDuringControlledPreparation(
				true, true, true, false, true, false, 500, 2000,
			),
		).toBe(false);
		expect(
			retainHighlightingDuringControlledPreparation(
				true, true, true, false, false, false, 2000, 2000,
			),
		).toBe(false);
	});
});

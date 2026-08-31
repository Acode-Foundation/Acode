import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import {
	fixedHeightTheme,
	renderingPerformanceExtensions,
} from "cm/mainEditorExtensions";

function themeRules(extension: unknown): string {
	return (extension as Array<{ value?: { rules?: string[] } }>)
		.flatMap((part) => part?.value?.rules ?? [])
		.join("\n");
}

describe("main editor scroller theme", () => {
	it("keeps scrolling native without persistent compositor containment", () => {
		const rules = themeRules(fixedHeightTheme);

		expect(rules).toContain("height: 100%");
		expect(rules).toContain("overflow: auto");
		expect(rules).not.toContain("will-change");
		expect(rules).not.toContain("content-visibility");
	});

	it("enables bounded render-gated touch scrolling for main editors", () => {
		const state = EditorState.create({
			extensions: renderingPerformanceExtensions,
		});

		expect(state.facet(EditorView.controlledTouchScroll)).toEqual({
			maxAhead: 4,
			settleDelay: 120,
		});
	});
});

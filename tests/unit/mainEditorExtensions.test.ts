import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
	createMainEditorExtensions,
	fixedHeightTheme,
	renderingPerformanceExtensions,
} from "cm/mainEditorExtensions";
import { describe, expect, it } from "vitest";

function themeRules(extension: unknown): string {
	return (extension as Array<{ value?: { rules?: string[] } }>)
		.flatMap((part) => part?.value?.rules ?? [])
		.join("\n");
}

describe("main editor scroller theme", () => {
	it("keeps the scroller free of persistent compositor containment", () => {
		const rules = themeRules(fixedHeightTheme);

		expect(rules).toContain("height: 100%");
		expect(rules).toContain("overflow: auto");
		expect(rules).not.toContain("will-change");
		expect(rules).not.toContain("content-visibility");
	});

	it("keeps movement independent of rendering with a two-screen directional buffer", () => {
		const state = EditorState.create({
			extensions: renderingPerformanceExtensions,
		});

		expect(state.facet(EditorView.controlledTouchScroll)).toEqual({
			maxAhead: 2,
			settleDelay: 120,
			waitForRendering: false,
		});
	});

	it("can disable the rendering extensions for an upstream comparison", () => {
		const state = EditorState.create({
			extensions: createMainEditorExtensions({ renderingExtensions: [] }),
		});
		expect(state.facet(EditorView.controlledTouchScroll)).toBeNull();
		expect(state.facet(EditorView.viewportBuffer)).toBeNull();
	});
});

// @vitest-environment happy-dom

import {
	openSearchPanel,
	search,
	SearchQuery,
	setSearchQuery,
} from "@codemirror/search";
import { EditorSelection, EditorState } from "@codemirror/state";
import { type DecorationSet, EditorView } from "@codemirror/view";
import searchMatchHighlighter, {
	buildSearchMatchDecorations,
} from "cm/searchMatchHighlighter";
import { afterEach, describe, expect, it } from "vitest";

interface HighlightRange {
	from: number;
	to: number;
	className: string;
}

const views: EditorView[] = [];

afterEach(() => {
	while (views.length) views.pop()?.destroy();
	document.body.replaceChildren();
});

function searchState(
	doc: string,
	searchText: string,
	selection = EditorSelection.cursor(0),
	options: Partial<ConstructorParameters<typeof SearchQuery>[0]> = {},
): EditorState {
	const state = EditorState.create({
		doc,
		selection,
		extensions: search(),
	});
	return state.update({
		effects: setSearchQuery.of(
			new SearchQuery({ search: searchText, ...options }),
		),
	}).state;
}

function highlightRanges(
	state: EditorState,
	visibleRanges: readonly { from: number; to: number }[],
): HighlightRange[] {
	return decorationRanges(
		buildSearchMatchDecorations(state, visibleRanges),
		state.doc.length,
	);
}

function decorationRanges(
	decorations: DecorationSet,
	docLength: number,
): HighlightRange[] {
	const ranges: HighlightRange[] = [];
	decorations.between(0, docLength, (from, to, decoration) => {
		ranges.push({
			from,
			to,
			className: String(decoration.spec.class ?? ""),
		});
	});
	return ranges;
}

describe("custom search match highlighter", () => {
	it("reacts to custom query and selection updates without a native panel", () => {
		const view = new EditorView({
			state: EditorState.create({
				doc: "foo foo",
				extensions: [search(), searchMatchHighlighter],
			}),
			parent: document.body,
		});
		views.push(view);

		view.dispatch({
			effects: setSearchQuery.of(new SearchQuery({ search: "foo" })),
		});
		view.dispatch({ selection: EditorSelection.range(4, 7) });

		const plugin = view.plugin(searchMatchHighlighter);
		expect(plugin).not.toBeNull();
		expect(
			decorationRanges(plugin!.decorations, view.state.doc.length),
		).toEqual([
			{ from: 0, to: 3, className: "cm-searchMatch" },
			{
				from: 4,
				to: 7,
				className: "cm-searchMatch cm-searchMatch-selected",
			},
		]);
	});

	it("highlights every match in the rendered range and marks the selection", () => {
		const state = searchState(
			"foo foo foo",
			"foo",
			EditorSelection.range(4, 7),
		);

		expect(highlightRanges(state, [{ from: 0, to: state.doc.length }])).toEqual(
			[
				{ from: 0, to: 3, className: "cm-searchMatch" },
				{
					from: 4,
					to: 7,
					className: "cm-searchMatch cm-searchMatch-selected",
				},
				{ from: 8, to: 11, className: "cm-searchMatch" },
			],
		);
	});

	it("limits work to the viewport instead of scanning a large document", () => {
		const padding = "x".repeat(100_000);
		const doc = `needle${padding}needle${padding}needle`;
		const middleMatch = 6 + padding.length;
		const state = searchState(doc, "needle");

		expect(
			highlightRanges(state, [
				{ from: middleMatch - 10, to: middleMatch + 16 },
			]),
		).toEqual([
			{ from: middleMatch, to: middleMatch + 6, className: "cm-searchMatch" },
		]);
	});

	it("merges nearby viewport windows so matches are not decorated twice", () => {
		const state = searchState("foo foo foo", "foo");

		expect(
			highlightRanges(state, [
				{ from: 0, to: 5 },
				{ from: 6, to: 11 },
			]),
		).toHaveLength(3);
	});

	it("leaves highlighting to CodeMirror when its native panel is open", () => {
		const view = new EditorView({
			state: searchState("foo foo", "foo"),
			parent: document.body,
		});
		views.push(view);

		openSearchPanel(view);

		expect(
			highlightRanges(view.state, [{ from: 0, to: view.state.doc.length }]),
		).toEqual([]);
	});
});

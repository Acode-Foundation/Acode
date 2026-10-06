import {
	getSearchQuery,
	searchPanelOpen,
	type SearchQuery,
} from "@codemirror/search";
import { RangeSetBuilder, type EditorState } from "@codemirror/state";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import { Decoration, EditorView, ViewPlugin } from "@codemirror/view";

interface DocRange {
	from: number;
	to: number;
}

// Keep the same regular-expression look-around used by CodeMirror's built-in
// search highlighter. Literal searches only need enough context to catch a
// match that crosses a viewport boundary.
const REGEXP_SCAN_MARGIN = 250;

const matchMark = Decoration.mark({ class: "cm-searchMatch" });
const selectedMatchMark = Decoration.mark({
	class: "cm-searchMatch cm-searchMatch-selected",
});

function scanMargin(query: SearchQuery): number {
	return query.regexp ? REGEXP_SCAN_MARGIN : query.search.length;
}

function sameHighlightQuery(left: SearchQuery, right: SearchQuery): boolean {
	return (
		left.search === right.search &&
		left.caseSensitive === right.caseSensitive &&
		left.literal === right.literal &&
		left.regexp === right.regexp &&
		left.wholeWord === right.wholeWord &&
		left.test === right.test
	);
}

function scanRanges(
	visibleRanges: readonly DocRange[],
	margin: number,
	docLength: number,
): DocRange[] {
	const ranges: DocRange[] = [];

	for (const visible of visibleRanges) {
		const from = Math.max(0, visible.from - margin);
		const to = Math.min(docLength, visible.to + margin);
		const previous = ranges[ranges.length - 1];

		if (previous && from <= previous.to) {
			previous.to = Math.max(previous.to, to);
		} else {
			ranges.push({ from, to });
		}
	}

	return ranges;
}

/**
 * Builds search marks only around rendered document ranges. Keeping this
 * separate from the view plugin makes the viewport-only behavior testable.
 */
export function buildSearchMatchDecorations(
	state: EditorState,
	visibleRanges: readonly DocRange[],
): DecorationSet {
	const query = getSearchQuery(state);
	if (!query.search || !query.valid || searchPanelOpen(state)) {
		return Decoration.none;
	}

	const builder = new RangeSetBuilder<Decoration>();
	const ranges = scanRanges(visibleRanges, scanMargin(query), state.doc.length);
	const selectedRanges = new Map<number, Set<number>>();
	for (const range of state.selection.ranges) {
		let ends = selectedRanges.get(range.from);
		if (!ends) selectedRanges.set(range.from, (ends = new Set()));
		ends.add(range.to);
	}

	for (const { from, to } of ranges) {
		const cursor = query.getCursor(state, from, to);
		for (let result = cursor.next(); !result.done; result = cursor.next()) {
			const match = result.value;
			const selected = selectedRanges.get(match.from)?.has(match.to) === true;
			builder.add(
				match.from,
				match.to,
				selected ? selectedMatchMark : matchMark,
			);
		}
	}

	return builder.finish();
}

class SearchMatchHighlighterPlugin {
	decorations: DecorationSet;

	constructor(view: EditorView) {
		this.decorations = buildSearchMatchDecorations(
			view.state,
			view.visibleRanges,
		);
	}

	update(update: ViewUpdate): void {
		const queryChanged = !sameHighlightQuery(
			getSearchQuery(update.state),
			getSearchQuery(update.startState),
		);
		const panelChanged =
			searchPanelOpen(update.state) !== searchPanelOpen(update.startState);

		if (
			queryChanged ||
			panelChanged ||
			update.docChanged ||
			update.selectionSet ||
			update.viewportChanged
		) {
			this.decorations = buildSearchMatchDecorations(
				update.state,
				update.view.visibleRanges,
			);
		}
	}
}

export const searchMatchHighlighter = ViewPlugin.fromClass(
	SearchMatchHighlighterPlugin,
	{
		decorations: (plugin) => plugin.decorations,
	},
);

export default searchMatchHighlighter;

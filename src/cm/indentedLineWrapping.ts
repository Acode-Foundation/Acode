import {
	EditorState,
	type Extension,
	RangeSetBuilder,
	StateEffect,
} from "@codemirror/state";
import {
	Decoration,
	type DecorationSet,
	EditorView,
	ViewPlugin,
	type ViewUpdate,
} from "@codemirror/view";

const wrapWidth = StateEffect.define<number>();

/** Keep tab stops on the first visual row unchanged by the negative indent. */
export function wrappedIndentColumns(
	text: string,
	tabSize: number,
	limit: number,
): number {
	// Unindented/minified lines need no tab scan, even when they are megabytes long.
	if (limit <= 0 || (text[0] !== " " && text[0] !== "\t")) return 0;
	const hasTabs = text.includes("\t");
	const step = hasTabs ? tabSize : 1;
	const cap = Math.max(0, Math.floor(limit / step) * step);
	let columns = 0;
	for (const char of text) {
		if (char === " ") columns++;
		else if (char === "\t") columns += tabSize - (columns % tabSize);
		else break;
		if (columns >= cap) return cap;
	}
	return Math.min(cap, Math.ceil(columns / step) * step);
}

interface CachedIndent {
	text: string;
	decoration: Decoration | null;
}

function decorate(
	view: EditorView,
	limit: number,
	previous: Map<number, CachedIndent>,
): { decorations: DecorationSet; cache: Map<number, CachedIndent> } {
	const builder = new RangeSetBuilder<Decoration>();
	const tabSize = view.state.facet(EditorState.tabSize);
	const cache = new Map<number, CachedIndent>();
	const styles = new Map<number, Decoration>();
	let lastLine = -1;
	for (const { from, to } of view.visibleRanges) {
		for (let pos = from; pos <= to; ) {
			const line = view.state.doc.lineAt(pos);
			if (line.from > lastLine) {
				let entry = previous.get(line.from);
				if (!entry || entry.text !== line.text) {
					const columns = wrappedIndentColumns(line.text, tabSize, limit);
					let decoration = columns ? styles.get(columns) : null;
					if (columns && !decoration) {
						decoration = Decoration.line({
							attributes: {
								class: "cm-wrap-indent",
								style: `--cm-wrap-indent: ${columns}ch`,
							},
						});
						styles.set(columns, decoration);
					}
					entry = { text: line.text, decoration: decoration ?? null };
				}
				cache.set(line.from, entry);
				if (entry.decoration)
					builder.add(line.from, line.from, entry.decoration);
				lastLine = line.from;
			}
			pos = line.to + 1;
		}
	}
	// Drop offscreen entries rather than retaining strings from the whole file.
	return { decorations: builder.finish(), cache };
}

const plugin = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet = Decoration.none;
		limit = 0;
		cache = new Map<number, CachedIndent>();

		constructor(view: EditorView) {
			this.measure(view);
		}

		measure(view: EditorView) {
			view.requestMeasure({
				key: this,
				read: () =>
					Math.max(
						0,
						Math.floor(
							(view.contentDOM.clientWidth - 8) /
								view.defaultCharacterWidth /
								2,
						),
					),
				write: (limit) => {
					if (limit === this.limit) return;
					// Measurement writes run inside CodeMirror's update. Dispatch only
					// after it finishes, and ignore work queued by a removed plugin.
					queueMicrotask(() => {
						if (view.plugin(plugin) === this && limit !== this.limit) {
							view.dispatch({ effects: wrapWidth.of(limit) });
						}
					});
				},
			});
		}

		update(update: ViewUpdate) {
			let changed = false;
			for (const transaction of update.transactions) {
				for (const effect of transaction.effects) {
					if (effect.is(wrapWidth)) {
						this.limit = effect.value;
						changed = true;
					}
				}
			}
			const tabSizeChanged =
				update.startState.facet(EditorState.tabSize) !==
				update.state.facet(EditorState.tabSize);
			if (changed || tabSizeChanged) {
				this.cache.clear();
			} else if (update.docChanged) {
				// Keep unchanged visible lines cached when earlier edits shift them.
				this.cache = new Map(
					Array.from(this.cache, ([pos, entry]) => [
						update.changes.mapPos(pos, -1),
						entry,
					]),
				);
			}
			if (
				changed ||
				update.docChanged ||
				update.viewportChanged ||
				tabSizeChanged
			) {
				const result = decorate(update.view, this.limit, this.cache);
				this.decorations = result.decorations;
				this.cache = result.cache;
			}
			if (update.geometryChanged) this.measure(update.view);
		}
	},
	{ decorations: (value) => value.decorations },
);

/**
 * Browser-native soft wrapping, with no widgets, replacement text, or input
 * handlers. Line attributes leave CodeMirror's text/selection/composition DOM
 * under its own control. `ch` tracks font changes without rounding tab stops.
 * Mixed tab/space indents round up to a tab stop; oversized indents are capped
 * at half the available columns so narrow panes still have room for content.
 */
export function indentedLineWrapping(): Extension {
	return [
		EditorView.lineWrapping,
		plugin,
		EditorView.baseTheme({
			".cm-line.cm-wrap-indent": {
				paddingInlineStart: "calc(6px + var(--cm-wrap-indent))",
				textIndent: "calc(-1 * var(--cm-wrap-indent))",
			},
			".cm-wrap-indent > *": {
				// Inline-block indent guides and widgets must not inherit the indent.
				textIndent: "0",
			},
		}),
	];
}

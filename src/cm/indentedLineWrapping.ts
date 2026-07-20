import type { Extension } from "@codemirror/state";
import { EditorState, RangeSetBuilder } from "@codemirror/state";
import {
	Decoration,
	type DecorationSet,
	EditorView,
	ViewPlugin,
	type ViewUpdate,
} from "@codemirror/view";

export interface IndentedLineWrappingConfig {
	/** How continuation rows are indented relative to the logical line. */
	mode?: WrappingIndentMode;
	/**
	 * Absolute maximum continuation indent in visual columns. The effective
	 * maximum is also limited to half of the editor's visible width.
	 */
	maxIndentColumns?: number;
}

export type WrappingIndentMode = "none" | "same" | "indent" | "deepIndent";

export const DEFAULT_WRAPPING_INDENT_MODE: WrappingIndentMode = "indent";
export const DEFAULT_MAX_WRAP_INDENT_COLUMNS = 40;

const WRAPPED_LINE_CLASS = "cm-indented-line-wrap";
const WRAP_INDENT_PROPERTY = "--cm-wrap-indent";
const WRAP_INDENT_NEGATIVE_PROPERTY = "--cm-wrap-indent-negative";

type DecorationCache = Map<number, Decoration>;

function getTabSize(state: EditorState): number {
	const tabSize = state.facet(EditorState.tabSize);
	return Number.isFinite(tabSize) && tabSize > 0
		? Math.max(1, Math.trunc(tabSize))
		: 4;
}

function normalizeMaxIndentColumns(value: number | undefined): number {
	if (!Number.isFinite(value) || Number(value) <= 0) {
		return DEFAULT_MAX_WRAP_INDENT_COLUMNS;
	}
	return Math.max(1, Math.trunc(Number(value)));
}

function normalizeWrappingIndentMode(
	value: WrappingIndentMode | undefined,
): WrappingIndentMode {
	switch (value) {
		case "none":
		case "same":
		case "indent":
		case "deepIndent":
			return value;
		default:
			return DEFAULT_WRAPPING_INDENT_MODE;
	}
}

/**
 * Count leading indentation in visual columns. The scan stops as soon as the
 * configured cap is reached, keeping even pathological lines cheap to process.
 */
export function getWrapIndentColumns(
	line: string,
	tabSize: number,
	maxIndentColumns = DEFAULT_MAX_WRAP_INDENT_COLUMNS,
): number {
	const normalizedTabSize =
		Number.isFinite(tabSize) && tabSize > 0
			? Math.max(1, Math.trunc(tabSize))
			: 4;
	const normalizedMax = normalizeMaxIndentColumns(maxIndentColumns);
	let columns = 0;

	for (let index = 0; index < line.length; index++) {
		const character = line.charCodeAt(index);
		if (character === 32) {
			columns++;
		} else if (character === 9) {
			columns += normalizedTabSize - (columns % normalizedTabSize);
		} else {
			break;
		}

		if (columns >= normalizedMax) return normalizedMax;
	}

	return columns;
}

/**
 * Calculate the visual column where wrapped continuation rows should start.
 * `indent` mirrors Ace and VS Code by adding one indentation step, while
 * `deepIndent` adds two.
 */
export function getContinuationIndentColumns(
	line: string,
	tabSize: number,
	mode: WrappingIndentMode = DEFAULT_WRAPPING_INDENT_MODE,
	maxIndentColumns = DEFAULT_MAX_WRAP_INDENT_COLUMNS,
): number {
	if (!line.length || mode === "none") return 0;

	const normalizedTabSize =
		Number.isFinite(tabSize) && tabSize > 0
			? Math.max(1, Math.trunc(tabSize))
			: 4;
	const normalizedMax = normalizeMaxIndentColumns(maxIndentColumns);
	const baseIndent = getWrapIndentColumns(
		line,
		normalizedTabSize,
		normalizedMax,
	);
	const additionalIndent =
		mode === "deepIndent"
			? normalizedTabSize * 2
			: mode === "indent"
				? normalizedTabSize
				: 0;

	return Math.min(baseIndent + additionalIndent, normalizedMax);
}

function getEffectiveMaxIndentColumns(
	view: EditorView,
	absoluteMaximum: number,
): number {
	const tabSize = getTabSize(view.state);
	const characterWidth = view.defaultCharacterWidth;
	const contentWidth = view.scrollDOM.clientWidth || view.dom.clientWidth;

	if (
		!Number.isFinite(characterWidth) ||
		characterWidth <= 0 ||
		!Number.isFinite(contentWidth) ||
		contentWidth <= 0
	) {
		return absoluteMaximum;
	}

	const halfVisibleColumns = Math.floor(contentWidth / characterWidth / 2);
	return Math.max(
		1,
		Math.min(absoluteMaximum, Math.max(tabSize, halfVisibleColumns)),
	);
}

function getLineDecoration(
	columns: number,
	cache: DecorationCache,
): Decoration {
	let decoration = cache.get(columns);
	if (decoration) return decoration;

	decoration = Decoration.line({
		attributes: {
			class: WRAPPED_LINE_CLASS,
			style: `${WRAP_INDENT_PROPERTY}:${columns}ch;${WRAP_INDENT_NEGATIVE_PROPERTY}:-${columns}ch`,
		},
	});
	cache.set(columns, decoration);
	return decoration;
}

function buildDecorations(
	view: EditorView,
	mode: WrappingIndentMode,
	maxIndentColumns: number,
	cache: DecorationCache,
): DecorationSet {
	const builder = new RangeSetBuilder<Decoration>();
	const { doc } = view.state;
	const tabSize = getTabSize(view.state);
	let lastProcessedLine = 0;

	for (const { from, to } of view.visibleRanges) {
		const firstLine = doc.lineAt(from);
		const lastLine = doc.lineAt(Math.max(from, to - 1));

		for (
			let lineNumber = firstLine.number;
			lineNumber <= lastLine.number;
			lineNumber++
		) {
			if (lineNumber <= lastProcessedLine) continue;
			lastProcessedLine = lineNumber;

			const line = doc.line(lineNumber);
			const columns = getContinuationIndentColumns(
				line.text,
				tabSize,
				mode,
				maxIndentColumns,
			);
			if (columns === 0) continue;

			builder.add(line.from, line.from, getLineDecoration(columns, cache));
		}
	}

	return builder.finish();
}

function createIndentedLineWrappingPlugin(
	mode: WrappingIndentMode,
	absoluteMaxIndentColumns: number,
): Extension {
	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;
			decorationCache: DecorationCache = new Map();
			lastTabSize: number;
			lastMaxIndentColumns: number;

			constructor(view: EditorView) {
				this.lastTabSize = getTabSize(view.state);
				this.lastMaxIndentColumns = getEffectiveMaxIndentColumns(
					view,
					absoluteMaxIndentColumns,
				);
				this.decorations = buildDecorations(
					view,
					mode,
					this.lastMaxIndentColumns,
					this.decorationCache,
				);
			}

			update(update: ViewUpdate): void {
				const tabSize = getTabSize(update.state);
				const maxIndentColumns = getEffectiveMaxIndentColumns(
					update.view,
					absoluteMaxIndentColumns,
				);
				if (
					!update.docChanged &&
					!update.viewportChanged &&
					tabSize === this.lastTabSize &&
					maxIndentColumns === this.lastMaxIndentColumns
				) {
					return;
				}

				this.lastTabSize = tabSize;
				this.lastMaxIndentColumns = maxIndentColumns;
				this.decorations = buildDecorations(
					update.view,
					mode,
					this.lastMaxIndentColumns,
					this.decorationCache,
				);
			}

			destroy(): void {
				this.decorationCache.clear();
			}
		},
		{
			decorations: (value) => value.decorations,
		},
	);
}

// The zero-width pseudo-element shifts only the first visual row back over the
// added padding. Unlike `text-indent`, it does not change CodeMirror's global
// line-origin measurement, which is also used by rectangular selections.
const indentedLineWrappingTheme = EditorView.baseTheme({
	[`.cm-line.${WRAPPED_LINE_CLASS}`]: {
		paddingInlineStart: `calc(6px + var(${WRAP_INDENT_PROPERTY}))`,
	},
	[`.cm-line.${WRAPPED_LINE_CLASS}::before`]: {
		content: '""',
		display: "inline-block",
		width: "0",
		height: "0",
		marginInlineStart: `var(${WRAP_INDENT_NEGATIVE_PROPERTY})`,
	},
});

/**
 * Enable regular CodeMirror line wrapping and align continuation rows with the
 * logical line's leading indentation.
 */
export function indentedLineWrapping(
	config: IndentedLineWrappingConfig = {},
): Extension {
	const mode = normalizeWrappingIndentMode(config.mode);
	const maxIndentColumns = normalizeMaxIndentColumns(config.maxIndentColumns);
	if (mode === "none") return EditorView.lineWrapping;

	return [
		EditorView.lineWrapping,
		createIndentedLineWrappingPlugin(mode, maxIndentColumns),
		indentedLineWrappingTheme,
	];
}

export default indentedLineWrapping;

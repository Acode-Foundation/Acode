import { getIndentUnit } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorState, RangeSetBuilder } from "@codemirror/state";
import {
	Decoration,
	type DecorationSet,
	EditorView,
	ViewPlugin,
	type ViewUpdate,
} from "@codemirror/view";

/**
 * Configuration options for indent guides
 */
export interface IndentGuidesConfig {
	/** Deprecated: active guide highlighting is disabled for performance. */
	highlightActiveGuide?: boolean;
	/** Whether to hide guides on blank lines */
	hideOnBlankLines?: boolean;
}

const defaultConfig: Required<IndentGuidesConfig> = {
	highlightActiveGuide: false,
	hideOnBlankLines: false,
};

const GUIDE_MARK_CLASS = "cm-indent-guides";
const GUIDE_LINE_CLASS = "cm-indent-guides-line";
const MAX_VISIBLE_GUIDE_LINES = 500;
const MAX_GUIDE_LEVELS = 40;

interface IndentLineInfo {
	text: string;
	tabSize: number;
	indentColumns: number;
	leadingWhitespaceLength: number;
	blank: boolean;
}

type IndentLineCache = Map<number, IndentLineInfo>;
type GuideStyleCache = Map<string, string>;

const BLANK_LINE_SCAN_LIMIT = 100;

/**
 * Get the tab size from editor state
 */
function getTabSize(state: EditorState): number {
	const tabSize = state.facet(EditorState.tabSize);
	return Number.isFinite(tabSize) && tabSize > 0 ? tabSize : 4;
}

/**
 * Resolve the indentation width used for guide spacing.
 */
function getIndentUnitColumns(state: EditorState): number {
	const width = getIndentUnit(state);
	if (Number.isFinite(width) && width > 0) return width;
	return getTabSize(state);
}

/**
 * Calculate the visual indentation of a line
 */
function getLineIndentation(line: string, tabSize: number): number {
	let columns = 0;
	for (const ch of line) {
		if (ch === " ") {
			columns++;
		} else if (ch === "\t") {
			columns += tabSize - (columns % tabSize);
		} else {
			break;
		}
	}
	return columns;
}

/**
 * Check if a line is blank
 */
function isBlankLine(line: string): boolean {
	return /^\s*$/.test(line);
}

/**
 * Count the leading indentation characters of a line.
 */
function getLeadingWhitespaceLength(line: string): number {
	let count = 0;
	for (const ch of line) {
		if (ch === " " || ch === "\t") {
			count++;
			continue;
		}
		break;
	}
	return count;
}

function buildGuideStyle(levels: number, guideStepPx: number): string {
	const images = [];
	const positions = [];
	const sizes = [];

	for (let i = 0; i < levels; i++) {
		const color = "var(--indent-guide-color)";
		images.push(`linear-gradient(${color}, ${color})`);
		positions.push(`${i * guideStepPx}px 0`);
		sizes.push("1px 100%");
	}

	return [
		`background-image:${images.join(",")}`,
		"background-repeat:no-repeat",
		`background-position:${positions.join(",")}`,
		`background-size:${sizes.join(",")}`,
	].join(";");
}

function getGuideStyle(
	levels: number,
	guideStepPx: number,
	styleCache: GuideStyleCache,
): string {
	const key = `${levels}:${guideStepPx}`;
	let style = styleCache.get(key);
	if (!style) {
		style = buildGuideStyle(levels, guideStepPx);
		styleCache.set(key, style);
	}
	return style;
}

function getCachedLineInfo(
	lineNumber: number,
	lineText: string,
	tabSize: number,
	cache: IndentLineCache,
): IndentLineInfo {
	const cached = cache.get(lineNumber);
	if (cached && cached.text === lineText && cached.tabSize === tabSize) {
		return cached;
	}

	const info = {
		text: lineText,
		tabSize,
		indentColumns: getLineIndentation(lineText, tabSize),
		leadingWhitespaceLength: getLeadingWhitespaceLength(lineText),
		blank: isBlankLine(lineText),
	};
	cache.set(lineNumber, info);
	return info;
}

/**
 * Build decorations for indent guides
 */
function buildDecorations(
	view: EditorView,
	config: Required<IndentGuidesConfig>,
	lineCache: IndentLineCache,
	styleCache: GuideStyleCache,
): DecorationSet {
	const builder = new RangeSetBuilder<Decoration>();
	const { state } = view;
	const tabSize = getTabSize(state);
	const indentUnit = getIndentUnitColumns(state);
	const guideStepPx = Math.max(view.defaultCharacterWidth * indentUnit, 1);
	let processedLines = 0;

	for (const { from: blockFrom, to: blockTo } of view.visibleRanges) {
		const startLine = state.doc.lineAt(blockFrom);
		const endLine = state.doc.lineAt(blockTo);
		const firstLineNumber = startLine.number;
		const lastLineNumber = endLine.number;
		const scanStartLine = Math.max(1, firstLineNumber - BLANK_LINE_SCAN_LIMIT);
		const scanEndLine = Math.min(
			state.doc.lines,
			lastLineNumber + BLANK_LINE_SCAN_LIMIT,
		);
		const prevIndentByLine = new Map<number, number>();
		const nextIndentByLine = new Map<number, number>();
		let prevIndent = -1;
		let prevIndentLine = -1;

		for (let lineNum = scanStartLine; lineNum <= scanEndLine; lineNum++) {
			const line = state.doc.line(lineNum);
			const info = getCachedLineInfo(lineNum, line.text, tabSize, lineCache);
			prevIndentByLine.set(
				lineNum,
				lineNum - prevIndentLine <= BLANK_LINE_SCAN_LIMIT ? prevIndent : -1,
			);
			if (!info.blank) {
				prevIndent = info.indentColumns;
				prevIndentLine = lineNum;
			}
		}

		let nextIndent = -1;
		let nextIndentLine = state.doc.lines + 1;
		for (let lineNum = scanEndLine; lineNum >= scanStartLine; lineNum--) {
			const line = state.doc.line(lineNum);
			const info = getCachedLineInfo(lineNum, line.text, tabSize, lineCache);
			nextIndentByLine.set(
				lineNum,
				nextIndentLine - lineNum <= BLANK_LINE_SCAN_LIMIT ? nextIndent : -1,
			);
			if (!info.blank) {
				nextIndent = info.indentColumns;
				nextIndentLine = lineNum;
			}
		}

		for (let lineNum = firstLineNumber; lineNum <= lastLineNumber; lineNum++) {
			if (processedLines >= MAX_VISIBLE_GUIDE_LINES) return builder.finish();
			processedLines++;

			const line = state.doc.line(lineNum);
			const info = getCachedLineInfo(lineNum, line.text, tabSize, lineCache);

			if (config.hideOnBlankLines && info.blank) {
				continue;
			}

			let indentColumns = info.indentColumns;
			if (info.blank) {
				const previousIndent = prevIndentByLine.get(lineNum) ?? -1;
				const followingIndent = nextIndentByLine.get(lineNum) ?? -1;
				if (previousIndent !== -1 && followingIndent !== -1) {
					indentColumns = Math.min(previousIndent, followingIndent);
				} else if (previousIndent !== -1) {
					indentColumns = previousIndent;
				} else if (followingIndent !== -1) {
					indentColumns = followingIndent;
				}
			}

			const levels = Math.min(
				Math.floor(indentColumns / indentUnit),
				MAX_GUIDE_LEVELS,
			);
			if (levels <= 0) continue;

			if (info.blank) {
				builder.add(
					line.from,
					line.from,
					Decoration.line({
						attributes: {
							class: GUIDE_LINE_CLASS,
							style: getGuideStyle(levels, guideStepPx, styleCache),
						},
					}),
				);
			} else {
				if (info.leadingWhitespaceLength <= 0) continue;
				builder.add(
					line.from,
					line.from + info.leadingWhitespaceLength,
					Decoration.mark({
						attributes: {
							class: GUIDE_MARK_CLASS,
							style: getGuideStyle(levels, guideStepPx, styleCache),
						},
					}),
				);
			}
		}
	}

	return builder.finish();
}

/**
 * ViewPlugin for indent guides
 */
function createIndentGuidesPlugin(
	config: Required<IndentGuidesConfig>,
): ViewPlugin<{
	decorations: DecorationSet;
	update(update: ViewUpdate): void;
}> {
	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;
			lineCache: IndentLineCache = new Map();
			styleCache: GuideStyleCache = new Map();
			lastCharWidth = 0;
			lastTabSize = 4;
			lastIndentUnit = 4;

			constructor(view: EditorView) {
				const { state } = view;
				this.lastCharWidth = view.defaultCharacterWidth;
				this.lastTabSize = getTabSize(state);
				this.lastIndentUnit = getIndentUnitColumns(state);

				this.decorations = buildDecorations(
					view,
					config,
					this.lineCache,
					this.styleCache,
				);
			}

			update(update: ViewUpdate): void {
				const { view, state } = update;
				let needsRebuild = false;

				if (update.docChanged) {
					this.decorations = this.decorations.map(update.changes);
					this.lineCache.clear();
					needsRebuild = true;
				}

				if (update.viewportChanged) {
					needsRebuild = true;
				}

				const currentTabSize = getTabSize(state);
				const currentIndentUnit = getIndentUnitColumns(state);
				const currentCharWidth = view.defaultCharacterWidth;

				if (
					currentTabSize !== this.lastTabSize ||
					currentIndentUnit !== this.lastIndentUnit
				) {
					this.lastTabSize = currentTabSize;
					this.lastIndentUnit = currentIndentUnit;
					this.lineCache.clear();
					this.styleCache.clear();
					needsRebuild = true;
				}

				if (currentCharWidth !== this.lastCharWidth) {
					this.lastCharWidth = currentCharWidth;
					this.styleCache.clear();
					needsRebuild = true;
				}

				if (needsRebuild) {
					this.decorations = buildDecorations(
						view,
						config,
						this.lineCache,
						this.styleCache,
					);
				}
			}

			destroy(): void {
				this.lineCache.clear();
				this.styleCache.clear();
			}
		},
		{
			decorations: (v) => v.decorations,
		},
	);
}

/**
 * Theme for indent guides.
 * Uses a single span around leading indentation instead of per-guide widgets.
 */
const indentGuidesTheme = EditorView.baseTheme({
	".cm-indent-guides": {
		display: "inline-block",
		verticalAlign: "top",
	},
	".cm-indent-guides-line": {
		backgroundOrigin: "content-box",
	},
	"&": {
		"--indent-guide-color": "rgba(128, 128, 128, 0.25)",
	},
	"&light": {
		"--indent-guide-color": "rgba(0, 0, 0, 0.1)",
	},
	"&dark": {
		"--indent-guide-color": "rgba(255, 255, 255, 0.1)",
	},
});

export function indentGuides(config: IndentGuidesConfig = {}): Extension {
	const mergedConfig: Required<IndentGuidesConfig> = {
		...defaultConfig,
		...config,
	};

	return [createIndentGuidesPlugin(mergedConfig), indentGuidesTheme];
}

export function indentGuidesExtension(
	enabled: boolean,
	config: IndentGuidesConfig = {},
): Extension {
	if (!enabled) return [];
	return indentGuides(config);
}

export default indentGuides;

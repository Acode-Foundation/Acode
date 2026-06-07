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
const MAX_VISIBLE_GUIDE_LINES = 1200;
const MAX_GUIDE_LEVELS = 40;
const REBUILD_DELAY_MS = 50;

interface IndentLineInfo {
	text: string;
	tabSize: number;
	indentColumns: number;
	leadingWhitespaceLength: number;
	blank: boolean;
}

type IndentLineCache = Map<number, IndentLineInfo>;
type GuideStyleCache = Map<string, string>;

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

		for (let lineNum = startLine.number; lineNum <= endLine.number; lineNum++) {
			if (processedLines >= MAX_VISIBLE_GUIDE_LINES) return builder.finish();
			processedLines++;

			const line = state.doc.line(lineNum);
			const info = getCachedLineInfo(lineNum, line.text, tabSize, lineCache);

			if (config.hideOnBlankLines && info.blank) {
				continue;
			}

			const levels = Math.min(
				Math.floor(info.indentColumns / indentUnit),
				MAX_GUIDE_LEVELS,
			);
			if (levels <= 0) continue;
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
			rebuildTimer = 0;
			pendingView: EditorView | null = null;
			lineCache: IndentLineCache = new Map();
			styleCache: GuideStyleCache = new Map();

			constructor(view: EditorView) {
				this.decorations = Decoration.none;
				this.scheduleBuild(view);
			}

			update(update: ViewUpdate): void {
				if (
					!update.docChanged &&
					!update.viewportChanged &&
					!update.geometryChanged
				) {
					return;
				}
				if (update.docChanged) {
					this.decorations = this.decorations.map(update.changes);
					this.lineCache.clear();
				}
				if (update.geometryChanged) {
					this.styleCache.clear();
				}
				this.scheduleBuild(update.view);
			}

			scheduleBuild(view: EditorView): void {
				this.pendingView = view;
				if (this.rebuildTimer) return;
				this.rebuildTimer = window.setTimeout(() => {
					this.rebuildTimer = 0;
					const pendingView = this.pendingView;
					this.pendingView = null;
					if (!pendingView) return;
					this.decorations = buildDecorations(
						pendingView,
						config,
						this.lineCache,
						this.styleCache,
					);
				}, REBUILD_DELAY_MS);
			}

			destroy(): void {
				if (this.rebuildTimer) {
					window.clearTimeout(this.rebuildTimer);
					this.rebuildTimer = 0;
				}
				this.pendingView = null;
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

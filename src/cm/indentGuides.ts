import { getIndentUnit, syntaxTree } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorState, RangeSetBuilder } from "@codemirror/state";
import {
	Decoration,
	type DecorationSet,
	EditorView,
	ViewPlugin,
	type ViewUpdate,
} from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";

/**
 * Configuration options for indent guides
 */
export interface IndentGuidesConfig {
	/** Whether to highlight the guide at the cursor's indent level */
	highlightActiveGuide?: boolean;
	/** Whether to hide guides on blank lines */
	hideOnBlankLines?: boolean;
}

const defaultConfig: Required<IndentGuidesConfig> = {
	highlightActiveGuide: true,
	hideOnBlankLines: false,
};

const GUIDE_MARK_CLASS = "cm-indent-guides";

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

/**
 * Node types that represent scope blocks in various languages
 */
const SCOPE_NODE_TYPES = new Set([
	"Block",
	"ObjectExpression",
	"ArrayExpression",
	"ArrowFunction",
	"FunctionDeclaration",
	"FunctionExpression",
	"ClassBody",
	"ClassDeclaration",
	"MethodDeclaration",
	"SwitchBody",
	"IfStatement",
	"WhileStatement",
	"ForStatement",
	"ForInStatement",
	"ForOfStatement",
	"TryStatement",
	"CatchClause",
	"Object",
	"Array",
	"Element",
	"SelfClosingTag",
	"RuleSet",
	"DeclarationList",
	"Body",
	"Suite",
	"Program",
	"Script",
	"Module",
]);

/**
 * Information about the active scope for highlighting
 */
interface ActiveScope {
	level: number;
	startLine: number;
	endLine: number;
}

/**
 * Find the active scope using syntax tree analysis
 */
function getActiveScope(
	view: EditorView,
	indentUnit: number,
): ActiveScope | null {
	const { state } = view;
	const { main } = state.selection;
	const cursorPos = main.head;

	const tree = syntaxTree(state);
	if (!tree || tree.length === 0) {
		return getActiveScopeByIndentation(state, indentUnit);
	}

	let scopeNode: SyntaxNode | null = null;
	let node: SyntaxNode | null = tree.resolveInner(cursorPos, 0);

	while (node) {
		if (SCOPE_NODE_TYPES.has(node.name)) {
			scopeNode = node;
			break;
		}
		node = node.parent;
	}

	if (!scopeNode) {
		return null;
	}

	const startLine = state.doc.lineAt(scopeNode.from);
	const endLine = state.doc.lineAt(scopeNode.to);
	let contentStartLine = startLine.number;
	if (startLine.number < endLine.number) {
		contentStartLine = startLine.number + 1;
	}

	const tabSize = getTabSize(state);
	let level = 0;

	for (let ln = contentStartLine; ln <= endLine.number; ln++) {
		const line = state.doc.line(ln);
		if (!isBlankLine(line.text)) {
			const indent = getLineIndentation(line.text, tabSize);
			level = Math.floor(indent / indentUnit);
			break;
		}
	}

	if (level <= 0) {
		return null;
	}

	return {
		level,
		startLine: startLine.number,
		endLine: endLine.number,
	};
}

/**
 * Fallback: Find active scope by indentation when no syntax tree is available
 */
function getActiveScopeByIndentation(
	state: EditorState,
	indentUnit: number,
): ActiveScope | null {
	const { main } = state.selection;
	const cursorLine = state.doc.lineAt(main.head);
	const tabSize = getTabSize(state);

	let cursorIndent = getLineIndentation(cursorLine.text, tabSize);

	if (isBlankLine(cursorLine.text)) {
		for (let lineNum = cursorLine.number - 1; lineNum >= 1; lineNum--) {
			const prevLine = state.doc.line(lineNum);
			if (!isBlankLine(prevLine.text)) {
				cursorIndent = getLineIndentation(prevLine.text, tabSize);
				break;
			}
		}
	}

	const cursorLevel = Math.floor(cursorIndent / indentUnit);
	if (cursorLevel <= 0) return null;

	let startLine = cursorLine.number;
	for (let lineNum = cursorLine.number - 1; lineNum >= 1; lineNum--) {
		const line = state.doc.line(lineNum);
		if (isBlankLine(line.text)) continue;
		const lineLevel = Math.floor(
			getLineIndentation(line.text, tabSize) / indentUnit,
		);
		if (lineLevel < cursorLevel) break;
		startLine = lineNum;
	}

	let endLine = cursorLine.number;
	for (
		let lineNum = cursorLine.number + 1;
		lineNum <= state.doc.lines;
		lineNum++
	) {
		const line = state.doc.line(lineNum);
		if (isBlankLine(line.text)) {
			endLine = lineNum;
			continue;
		}
		const lineLevel = Math.floor(
			getLineIndentation(line.text, tabSize) / indentUnit,
		);
		if (lineLevel < cursorLevel) break;
		endLine = lineNum;
	}

	return { level: cursorLevel, startLine, endLine };
}

function buildGuideStyle(
	levels: number,
	guideStepPx: number,
	activeGuideIndex: number,
): string {
	const images = [];
	const positions = [];
	const sizes = [];

	for (let i = 0; i < levels; i++) {
		const color =
			i === activeGuideIndex
				? "var(--indent-guide-active-color)"
				: "var(--indent-guide-color)";
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

/**
 * Build decorations for indent guides
 */
function buildDecorations(
	view: EditorView,
	config: Required<IndentGuidesConfig>,
): DecorationSet {
	const builder = new RangeSetBuilder<Decoration>();
	const { state } = view;
	const tabSize = getTabSize(state);
	const indentUnit = getIndentUnitColumns(state);
	const guideStepPx = Math.max(view.defaultCharacterWidth * indentUnit, 1);

	const activeScope = config.highlightActiveGuide
		? getActiveScope(view, indentUnit)
		: null;

	for (const { from: blockFrom, to: blockTo } of view.visibleRanges) {
		const startLine = state.doc.lineAt(blockFrom);
		const endLine = state.doc.lineAt(blockTo);

		for (let lineNum = startLine.number; lineNum <= endLine.number; lineNum++) {
			const line = state.doc.line(lineNum);
			const lineText = line.text;

			if (config.hideOnBlankLines && isBlankLine(lineText)) {
				continue;
			}

			const indentColumns = getLineIndentation(lineText, tabSize);
			const levels = Math.floor(indentColumns / indentUnit);
			if (levels <= 0) continue;
			const leadingWhitespaceLength = getLeadingWhitespaceLength(lineText);
			if (leadingWhitespaceLength <= 0) continue;

			let activeGuideIndex = -1;
			if (
				activeScope &&
				lineNum >= activeScope.startLine &&
				lineNum <= activeScope.endLine &&
				levels >= activeScope.level
			) {
				activeGuideIndex = activeScope.level - 1;
			}

			builder.add(
				line.from,
				line.from + leadingWhitespaceLength,
				Decoration.mark({
					attributes: {
						class: GUIDE_MARK_CLASS,
						style: buildGuideStyle(levels, guideStepPx, activeGuideIndex),
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
			raf = 0;
			pendingView: EditorView | null = null;

			constructor(view: EditorView) {
				this.decorations = buildDecorations(view, config);
			}

			update(update: ViewUpdate): void {
				if (
					!update.docChanged &&
					!update.viewportChanged &&
					!update.geometryChanged &&
					!(config.highlightActiveGuide && update.selectionSet)
				) {
					return;
				}
				this.scheduleBuild(update.view);
			}

			scheduleBuild(view: EditorView): void {
				this.pendingView = view;
				if (this.raf) return;
				// Guide rebuilding is cosmetic and can be expensive on large
				// viewports, so we intentionally collapse bursts into one frame.
				this.raf = requestAnimationFrame(() => {
					this.raf = 0;
					const pendingView = this.pendingView;
					this.pendingView = null;
					if (!pendingView) return;
					this.decorations = buildDecorations(pendingView, config);
				});
			}

			destroy(): void {
				if (this.raf) {
					cancelAnimationFrame(this.raf);
					this.raf = 0;
				}
				this.pendingView = null;
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
		"--indent-guide-active-color": "rgba(128, 128, 128, 0.7)",
	},
	"&light": {
		"--indent-guide-color": "rgba(0, 0, 0, 0.1)",
		"--indent-guide-active-color": "rgba(0, 0, 0, 0.4)",
	},
	"&dark": {
		"--indent-guide-color": "rgba(255, 255, 255, 0.1)",
		"--indent-guide-active-color": "rgba(255, 255, 255, 0.4)",
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

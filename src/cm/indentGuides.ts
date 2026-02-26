import { syntaxTree } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorState, RangeSetBuilder } from "@codemirror/state";
import {
	Decoration,
	type DecorationSet,
	EditorView,
	ViewPlugin,
	type ViewUpdate,
	WidgetType,
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

/**
 * Get the tab size from editor state
 */
function getTabSize(state: EditorState): number {
	return state.facet(EditorState.tabSize);
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
	"Block",
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
		// No syntax tree available, fall back to indentation-based
		return getActiveScopeByIndentation(state, indentUnit);
	}

	// Find the innermost scope node containing the cursor
	let scopeNode: SyntaxNode | null = null;
	let node: SyntaxNode | null = tree.resolveInner(cursorPos, 0);

	// Walk up the tree to find a scope-defining node
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

	// Get the line range of this scope
	const startLine = state.doc.lineAt(scopeNode.from);
	const endLine = state.doc.lineAt(scopeNode.to);

	// Calculate indent level from the first line of the scope's content
	// (usually the line after the opening bracket)
	let contentStartLine = startLine.number;
	if (startLine.number < endLine.number) {
		contentStartLine = startLine.number + 1;
	}

	const tabSize = getTabSize(state);
	let level = 0;

	// Find the first non-blank line inside the scope to determine indent level
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

/**
 * Widget that renders indent guide lines
 */
class IndentGuidesWidget extends WidgetType {
	constructor(
		readonly levels: number,
		readonly indentUnit: number,
		readonly activeGuideIndex: number,
		readonly lineHeight: number,
	) {
		super();
	}

	eq(other: IndentGuidesWidget): boolean {
		return (
			other.levels === this.levels &&
			other.indentUnit === this.indentUnit &&
			other.activeGuideIndex === this.activeGuideIndex &&
			other.lineHeight === this.lineHeight
		);
	}

	toDOM(): HTMLElement {
		const container = document.createElement("span");
		container.className = "cm-indent-guides-wrapper";
		container.setAttribute("aria-hidden", "true");

		const guidesContainer = document.createElement("span");
		guidesContainer.className = "cm-indent-guides";

		for (let i = 0; i < this.levels; i++) {
			const guide = document.createElement("span");
			guide.className = "cm-indent-guide";
			guide.style.left = `${i * this.indentUnit}ch`;
			guide.style.height = `${this.lineHeight}px`;

			if (i === this.activeGuideIndex) {
				guide.classList.add("cm-indent-guide-active");
			}

			guidesContainer.appendChild(guide);
		}

		container.appendChild(guidesContainer);
		return container;
	}

	ignoreEvent(): boolean {
		return true;
	}
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
	const indentUnit = tabSize;

	// Get active scope using syntax tree (or fallback to indentation)
	const activeScope = config.highlightActiveGuide
		? getActiveScope(view, indentUnit)
		: null;

	const lineHeight = view.defaultLineHeight;

	// Only process visible lines for performance
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

			if (levels > 0) {
				let activeGuideIndex = -1;

				// Check if this line is in the active scope
				if (
					activeScope &&
					lineNum >= activeScope.startLine &&
					lineNum <= activeScope.endLine &&
					levels >= activeScope.level
				) {
					activeGuideIndex = activeScope.level - 1;
				}

				const widget = new IndentGuidesWidget(
					levels,
					indentUnit,
					activeGuideIndex,
					lineHeight,
				);

				const deco = Decoration.widget({
					widget,
					side: -1,
				});

				builder.add(line.from, line.from, deco);
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

			constructor(view: EditorView) {
				this.decorations = buildDecorations(view, config);
			}

			update(update: ViewUpdate): void {
				// Only rebuild when necessary
				if (
					update.docChanged ||
					update.viewportChanged ||
					update.geometryChanged ||
					(config.highlightActiveGuide && update.selectionSet)
				) {
					this.decorations = buildDecorations(update.view, config);
				}
			}
		},
		{
			decorations: (v) => v.decorations,
		},
	);
}

/**
 * Theme for indent guides with subtle animation
 */
const indentGuidesTheme = EditorView.baseTheme({
	".cm-indent-guides-wrapper": {
		display: "inline",
		position: "relative",
		width: "0",
		height: "0",
		overflow: "visible",
		verticalAlign: "top",
	},
	".cm-indent-guides": {
		position: "absolute",
		top: "0",
		left: "0",
		height: "100%",
		pointerEvents: "none",
		zIndex: "0",
	},
	".cm-indent-guide": {
		position: "absolute",
		top: "0",
		width: "1px",
		background: "var(--indent-guide-color)",
		transition: "background 0.15s ease, opacity 0.15s ease",
	},
	".cm-indent-guide-active": {
		background: "var(--indent-guide-active-color)",
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

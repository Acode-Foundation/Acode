import { syntaxTree } from "@codemirror/language";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import { Decoration, EditorView, ViewPlugin } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";

const COLORS = ["gold", "orchid", "lightblue"];

// Token types that should be skipped (brackets inside these are not colored)
const SKIP_CONTEXTS = new Set([
	"String",
	"TemplateString",
	"Comment",
	"LineComment",
	"BlockComment",
	"RegExp",
]);

interface BracketInfo {
	from: number;
	to: number;
	depth: number;
	char: string;
}

const rainbowBracketsPlugin = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;

		constructor(view: EditorView) {
			this.decorations = this.buildDecorations(view);
		}

		update(update: ViewUpdate) {
			if (update.docChanged || update.viewportChanged) {
				this.decorations = this.buildDecorations(update.view);
			}
		}

		buildDecorations(view: EditorView): DecorationSet {
			const decorations: { from: number; to: number; color: string }[] = [];
			const tree = syntaxTree(view.state);

			// Process only visible ranges for performance
			for (const { from, to } of view.visibleRanges) {
				this.processRange(view, tree, from, to, decorations);
			}

			// Sort by position (required for Decoration.set)
			decorations.sort((a, b) => a.from - b.from);

			// Build decoration marks
			const marks = decorations.map((d) =>
				Decoration.mark({ class: `cm-bracket-${d.color}` }).range(d.from, d.to),
			);

			return Decoration.set(marks);
		}

		processRange(
			view: EditorView,
			tree: ReturnType<typeof syntaxTree>,
			from: number,
			to: number,
			decorations: { from: number; to: number; color: string }[],
		): void {
			const { doc } = view.state;
			const openBrackets: BracketInfo[] = [];

			// Iterate through the document in the visible range
			for (let pos = from; pos < to; pos++) {
				const char = doc.sliceString(pos, pos + 1);

				// Check if this is a bracket character
				if (!this.isBracketChar(char)) continue;

				// Use syntax tree to check if this bracket should be colored
				if (this.isInSkipContext(tree, pos)) continue;

				if (char === "(" || char === "[" || char === "{") {
					// Opening bracket - push to stack with current depth
					openBrackets.push({
						from: pos,
						to: pos + 1,
						depth: openBrackets.length,
						char,
					});
				} else if (char === ")" || char === "]" || char === "}") {
					// Closing bracket - find matching open bracket
					const matchingOpen = this.getMatchingOpenBracket(char);
					let matchFound = false;

					// Search backwards for matching open bracket
					for (let i = openBrackets.length - 1; i >= 0; i--) {
						if (openBrackets[i].char === matchingOpen) {
							const open = openBrackets[i];
							const depth = open.depth;
							const color = COLORS[depth % COLORS.length];

							// Add decorations for both brackets
							decorations.push(
								{ from: open.from, to: open.to, color },
								{ from: pos, to: pos + 1, color },
							);

							// Remove matched bracket and all unmatched brackets after it
							openBrackets.splice(i);
							matchFound = true;
							break;
						}
					}

					// If no match found, this is an unmatched closing bracket
					if (!matchFound) {
						// Unmatched closing bracket
					}
				}
			}
		}

		isBracketChar(char: string): boolean {
			return (
				char === "(" ||
				char === ")" ||
				char === "[" ||
				char === "]" ||
				char === "{" ||
				char === "}"
			);
		}

		isInSkipContext(tree: ReturnType<typeof syntaxTree>, pos: number): boolean {
			let node: SyntaxNode | null = tree.resolveInner(pos, 1);

			// Walk up the tree to check if we're inside a skip context
			while (node) {
				if (SKIP_CONTEXTS.has(node.name)) {
					return true;
				}
				node = node.parent;
			}

			return false;
		}

		getMatchingOpenBracket(closing: string): string | null {
			switch (closing) {
				case ")":
					return "(";
				case "]":
					return "[";
				case "}":
					return "{";
				default:
					return null;
			}
		}
	},
	{
		decorations: (v) => v.decorations,
	},
);

const theme = EditorView.baseTheme({
	".cm-bracket-gold": { color: "#FFD700 !important" },
	".cm-bracket-gold > span": { color: "#FFD700 !important" },
	".cm-bracket-orchid": { color: "#DA70D6 !important" },
	".cm-bracket-orchid > span": { color: "#DA70D6 !important" },
	".cm-bracket-lightblue": { color: "#179FFF !important" },
	".cm-bracket-lightblue > span": { color: "#179FFF !important" },
});

export function rainbowBrackets() {
	return [rainbowBracketsPlugin, theme];
}

export default rainbowBrackets;

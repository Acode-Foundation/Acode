import { cppLanguage } from "@codemirror/lang-cpp";
import { classHighlighter, highlightTree } from "@lezer/highlight";
import { describe, expect, it } from "vitest";

function highlightRanges(source) {
	const tree = cppLanguage.parser.parse(source);
	const inverted = [];
	tree.iterate({
		enter(node) {
			if (node.from > node.to) {
				inverted.push({ from: node.from, to: node.to, type: node.name });
			}
		},
	});

	const ranges = [];
	highlightTree(tree, classHighlighter, (from, to, classes) => {
		ranges.push({ from, to, classes });
	});

	const lastOffset = ranges.at(-1)?.to ?? 0;
	return {
		inverted,
		ranges,
		lastLine: source.slice(0, lastOffset).split("\n").length,
	};
}

describe("@lezer/lr C highlighting", () => {
	it("keeps highlighting after a comment/#define composite skipped node", () => {
		const source = [
			"",
			"// ─────────────────────────────────────────────────────────────",
			"//  COLORS (RGB565)",
			"// ─────────────────────────────────────────────────────────────",
			"#define C_BG         0x0841",
			"#define C_PANEL      0x1082",
			"int setup() {",
			"  return C_BG;",
			"}",
		].join("\n");

		const { inverted, ranges, lastLine } = highlightRanges(source);

		expect(inverted).toEqual([]);
		expect(ranges.length).toBeGreaterThan(10);
		expect(lastLine).toBe(source.split("\n").length);
		expect(ranges.some((range) => range.classes.includes("tok-keyword"))).toBe(
			true,
		);
	});
});

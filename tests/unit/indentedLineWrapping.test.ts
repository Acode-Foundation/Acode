import { wrappedIndentColumns } from "cm/indentedLineWrapping";
import { describe, expect, it, vi } from "vitest";

describe("wrapped line indentation", () => {
	it("preserves space indentation and stops at content", () => {
		expect(wrappedIndentColumns("   code   ", 4, 40)).toBe(3);
		expect(wrappedIndentColumns("code", 4, 40)).toBe(0);
		expect(wrappedIndentColumns("", 4, 40)).toBe(0);
	});
	it("counts tabs from their current column and rounds mixed indentation up", () => {
		expect(wrappedIndentColumns(" \tcode", 4, 40)).toBe(4);
		expect(wrappedIndentColumns(" \t  code", 4, 40)).toBe(8);
		expect(wrappedIndentColumns("\t code", 8, 40)).toBe(16);
	});
	it("rounds space indentation to preserve content tab alignment", () => {
		expect(wrappedIndentColumns("  key\tvalue", 4, 40)).toBe(4);
	});
	it("caps deep indentation without introducing fractional tab stops", () => {
		expect(wrappedIndentColumns(" ".repeat(10000), 4, 13)).toBe(13);
		expect(wrappedIndentColumns("\t".repeat(10000), 4, 13)).toBe(12);
		expect(wrappedIndentColumns("\tcode", 4, 3)).toBe(0);
		expect(wrappedIndentColumns("  code", 4, 0)).toBe(0);
	});
	it("adds one or two tab-sized levels to wrapped continuations", () => {
		expect(wrappedIndentColumns("code", 2, 40, "indent")).toBe(2);
		expect(wrappedIndentColumns("code", 2, 40, "deepIndent")).toBe(4);
		expect(wrappedIndentColumns("  code", 2, 40, "indent")).toBe(4);
		expect(wrappedIndentColumns("  code", 2, 40, "deepIndent")).toBe(6);
		expect(wrappedIndentColumns("  code", 4, 40, "deepIndent")).toBe(10);
	});
	it("disables continuation indentation in none mode", () => {
		expect(wrappedIndentColumns("\t  code", 4, 40, "none")).toBe(0);
	});
	it("keeps tab alignment and the width cap with extra indentation", () => {
		expect(wrappedIndentColumns("  key\tvalue", 4, 40, "indent")).toBe(8);
		expect(wrappedIndentColumns("key\tvalue", 4, 40, "deepIndent")).toBe(8);
		expect(wrappedIndentColumns("  key\tvalue", 4, 7, "deepIndent")).toBe(4);
		expect(wrappedIndentColumns("    code", 4, 7, "deepIndent")).toBe(7);
	});
	it("caps unindented lines at whole tab stops without depending on content tabs", () => {
		for (const text of ["code", "key\tvalue"]) {
			expect(wrappedIndentColumns(text, 4, 7, "deepIndent")).toBe(4);
			expect(wrappedIndentColumns(text, 4, 3, "indent")).toBe(0);
		}
	});
	it("skips the full-line tab search for large unindented lines in extra-indent modes", () => {
		const text = "x".repeat(1_000_000) + "\tvalue";
		const search = vi.spyOn(String.prototype, "includes");
		let calls: number;
		try {
			wrappedIndentColumns(text, 4, 40, "indent");
			wrappedIndentColumns(text, 4, 40, "deepIndent");
			wrappedIndentColumns(text, 4, 7, "deepIndent");
			calls = search.mock.calls.length;
		} finally {
			search.mockRestore();
		}
		expect(calls).toBe(0);
	});
});

import { wrappedIndentColumns } from "cm/indentedLineWrapping";
import { describe, expect, it } from "vitest";

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
});

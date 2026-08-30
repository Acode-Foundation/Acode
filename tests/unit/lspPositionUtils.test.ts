import { Text } from "@codemirror/state";
import { safeLspPositionToOffset } from "cm/lsp/positionUtils";
import { describe, expect, it } from "vitest";

describe("safeLspPositionToOffset", () => {
	const doc = Text.of(["alpha", "beta"]);

	it("converts valid positions and clamps oversized characters", () => {
		expect(safeLspPositionToOffset(doc, { line: 0, character: 2 })).toBe(2);
		expect(safeLspPositionToOffset(doc, { line: 1, character: 99 })).toBe(
			doc.length,
		);
	});

	it("accepts the exclusive one-past-EOF position used by LSP edits", () => {
		expect(
			safeLspPositionToOffset(doc, { line: doc.lines, character: 0 }),
		).toBe(doc.length);
		expect(
			safeLspPositionToOffset(doc, { line: doc.lines + 10, character: 4 }),
		).toBe(doc.length);
	});

	it("clamps negative lines and characters", () => {
		expect(safeLspPositionToOffset(doc, { line: -1, character: 20 })).toBe(0);
		expect(safeLspPositionToOffset(doc, { line: 1, character: -4 })).toBe(6);
	});
});

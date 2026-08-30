import { normalizeLocations } from "cm/lsp/locationUtils";
import { describe, expect, it } from "vitest";

const targetRange = {
	start: { line: 4, character: 1 },
	end: { line: 4, character: 8 },
};

describe("normalizeLocations", () => {
	it("keeps Location responses unchanged", () => {
		const location = { uri: "file:///project/a.ts", range: targetRange };
		expect(normalizeLocations(location)).toEqual([location]);
	});

	it("uses a LocationLink target selection range when present", () => {
		const selection = {
			start: { line: 4, character: 3 },
			end: { line: 4, character: 6 },
		};
		expect(
			normalizeLocations([
				{
					targetUri: "file:///project/a.ts",
					targetRange,
					targetSelectionRange: selection,
				},
			]),
		).toEqual([{ uri: "file:///project/a.ts", range: selection }]);
	});

	it("falls back to the LocationLink target range", () => {
		expect(
			normalizeLocations([
				{ targetUri: "file:///project/a.ts", targetRange },
			]),
		).toEqual([{ uri: "file:///project/a.ts", range: targetRange }]);
	});
});

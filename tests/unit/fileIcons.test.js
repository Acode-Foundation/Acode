import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const stylesheetPath = fileURLToPath(
	new URL("../../src/res/file-icons/style.css", import.meta.url),
);
const stylesheet = fs.readFileSync(stylesheetPath, "utf8");

function getDeclarations(selector) {
	for (const match of stylesheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
		const selectors = match[1].split(",").map((value) => value.trim());
		if (selectors.includes(selector)) return match[2].trim();
	}
	return null;
}

describe("TypeScript file icons", () => {
	it("uses the TypeScript glyph and color for TSX files", () => {
		const typescript = getDeclarations(".file_type_typescript:before");
		const ts = getDeclarations(".file_type_ts:before");
		const tsx = getDeclarations(".file_type_tsx:before");

		expect(typescript).toContain('content: "\\e98a"');
		expect(typescript).toContain("color: #007acc");
		expect(ts).toBe(typescript);
		expect(tsx).toBe(typescript);
	});
});

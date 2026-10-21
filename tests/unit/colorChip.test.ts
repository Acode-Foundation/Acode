// @vitest-environment happy-dom

import type { EditorView } from "@codemirror/view";
import { ColorChipWidget, getColorChipPayload } from "cm/colorChip";
import { describe, expect, it, vi } from "vitest";

// The picker dialog and color utilities (JSX) and the LSP client loader
// aren't needed here.
vi.mock("../../src/dialogs/color.js", () => ({ default: vi.fn() }));
vi.mock("../../src/utils/color/index.js", () => ({ default: vi.fn() }));
vi.mock("cm/lsp/clientLoader", () => ({ getAllLspPlugins: () => [] }));

const payload = {
	from: 4,
	to: 11,
	css: "#ff8800",
	source: "regex" as const,
};

describe("color chip widget", () => {
	it("tells a canvas view the box toDOM styles, in cells of its font", () => {
		const view = {
			defaultCharacterWidth: 8,
			fontSizePx: 16,
		} as unknown as EditorView;
		const spec = new ColorChipWidget(payload).toCanvas(view);
		// 0.9em of a 16px font is 14.4px: 1.8 cells, rounded to quarters.
		expect(spec).toEqual({
			text: "",
			cells: 1.75,
			padLeft: 0.25,
			padRight: 0.25,
			style: {
				background: "#ff8800",
				border: "rgba(0,0,0,0.2)",
				rounded: true,
			},
		});
	});

	it("still makes a DOM element carrying its payload (taps on canvas views)", () => {
		const el = new ColorChipWidget(payload).toDOM();
		expect(el.style.backgroundColor).toBeTruthy();
		expect(getColorChipPayload(el)).toBe(payload);
	});
});

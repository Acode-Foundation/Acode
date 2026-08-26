import {
	filterSelectionMenuItems,
	partitionSelectionMenuItems,
} from "cm/selectionMenuUtils";
import { describe, expect, it } from "vitest";

const items = [
	{ id: "copy", mode: "selected", readOnly: true },
	{ id: "cut", mode: "selected", readOnly: false },
	{ id: "paste", mode: "all", readOnly: false },
	{ id: "select-all", mode: "all", readOnly: true },
] as const;

describe("selection menu filtering", () => {
	it("keeps only read-only actions that apply to a selection", () => {
		const visible = filterSelectionMenuItems(items, {
			readOnly: true,
			hasSelection: true,
		});

		expect(visible.map((item) => item.id)).toEqual(["copy", "select-all"]);
	});

	it("hides selection-only actions when no text is selected", () => {
		const visible = filterSelectionMenuItems(items, {
			readOnly: true,
			hasSelection: false,
		});

		expect(visible.map((item) => item.id)).toEqual(["select-all"]);
	});

	it("keeps editable actions under the existing mode rules", () => {
		const visible = filterSelectionMenuItems(items, {
			readOnly: false,
			hasSelection: true,
		});

		expect(visible.map((item) => item.id)).toEqual([
			"copy",
			"cut",
			"paste",
			"select-all",
		]);
	});
});

describe("selection menu hierarchy", () => {
	it("keeps selection essentials in the compact toolbar", () => {
		const pluginItem = { id: "plugin-action", mode: "all" } as const;
		const { primary, overflow } = partitionSelectionMenuItems(
			[...items, pluginItem],
			{ hasSelection: true },
		);

		expect(primary.map((item) => item.id)).toEqual([
			"copy",
			"cut",
			"paste",
			"select-all",
		]);
		expect(overflow.map((item) => item.id)).toEqual(["plugin-action"]);
	});

	it("keeps caret actions concise and moves plugins into More", () => {
		const pluginItem = { mode: "all" } as const;
		const { primary, overflow } = partitionSelectionMenuItems(
			[...items, pluginItem],
			{ hasSelection: false },
		);

		expect(primary.map((item) => item.id)).toEqual(["paste", "select-all"]);
		expect(overflow).toEqual([items[0], items[1], pluginItem]);
	});
});

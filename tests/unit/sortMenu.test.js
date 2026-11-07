import { beforeEach, describe, expect, it, vi } from "vitest";

const settings = vi.hoisted(() => ({
	value: {
		fileBrowser: {
			sortByName: true,
			sortBy: "name",
			sortOrder: "asc",
			showHiddenFiles: false,
			foldersFirst: true,
		},
	},
	update: vi.fn(),
}));

vi.mock("lib/settings", () => ({ default: settings }));

import {
	chooseSortField,
	getSort,
	handleSortMenuClick,
	renderSortMenu,
	setSort,
} from "lib/sortMenu";

beforeEach(() => {
	settings.update.mockClear();
	settings.value.fileBrowser = {
		sortByName: true,
		sortBy: "name",
		sortOrder: "asc",
		showHiddenFiles: false,
		foldersFirst: true,
	};
	vi.stubGlobal("strings", {
		name: "Name",
		size: "Size",
		type: "Type",
		"last modified": "Last modified",
	});
});

describe("setSort", () => {
	it("stores a field and an order", () => {
		setSort({ sortBy: "size", sortOrder: "desc" });
		expect(settings.value.fileBrowser.sortBy).toBe("size");
		expect(settings.value.fileBrowser.sortOrder).toBe("desc");
		expect(settings.update).toHaveBeenCalledOnce();
	});

	it("ignores unknown fields and orders", () => {
		setSort({ sortBy: "colour", sortOrder: "sideways" });
		expect(settings.value.fileBrowser.sortBy).toBe("name");
		expect(settings.value.fileBrowser.sortOrder).toBe("asc");
	});

	it("turns sorting back on, since a named field is a request to sort", () => {
		settings.value.fileBrowser.sortByName = false;
		setSort({ sortBy: "date" });
		expect(settings.value.fileBrowser.sortByName).toBe(true);
	});
});

describe("getSort", () => {
	it("reports none when the legacy flag is off", () => {
		settings.value.fileBrowser.sortByName = false;
		expect(getSort().sortBy).toBe("none");
	});

	it("defaults the order to ascending", () => {
		delete settings.value.fileBrowser.sortOrder;
		expect(getSort().sortOrder).toBe("asc");
	});
});

describe("chooseSortField", () => {
	it("flips the direction when the field is already active", () => {
		settings.value.fileBrowser.sortBy = "name";
		settings.value.fileBrowser.sortOrder = "asc";
		chooseSortField("name");
		expect(settings.value.fileBrowser.sortOrder).toBe("desc");
	});

	it("starts a new field in the direction that is useful first", () => {
		chooseSortField("size");
		expect(settings.value.fileBrowser.sortBy).toBe("size");
		expect(settings.value.fileBrowser.sortOrder).toBe("desc");

		chooseSortField("name");
		expect(settings.value.fileBrowser.sortBy).toBe("name");
		expect(settings.value.fileBrowser.sortOrder).toBe("asc");
	});
});

describe("renderSortMenu", () => {
	it("lists every field and marks the active one with its direction", () => {
		settings.value.fileBrowser.sortBy = "date";
		settings.value.fileBrowser.sortOrder = "desc";
		const html = renderSortMenu();

		for (const label of ["Name", "Size", "Last modified", "Type"]) {
			expect(html).toContain(label);
		}
		expect(html).toMatch(
			/class="selected"><span>Last modified<\/span><span class="icon arrow arrow_downward">/,
		);
		// Exactly one row is marked active.
		expect(html.match(/class="selected"/g)).toHaveLength(1);
	});

	it("marks the direction of the active field only", () => {
		const html = renderSortMenu();
		expect(html.match(/arrow_upward/g)).toHaveLength(1);
	});
});

describe("handleSortMenuClick", () => {
	const clickOn = (dataset) => ({
		target: { closest: () => ({ dataset }) },
	});

	it("applies the chosen field", () => {
		expect(handleSortMenuClick(clickOn({ sortBy: "type" }))).toBe(true);
		expect(settings.value.fileBrowser.sortBy).toBe("type");
	});

	it("reports that it did not handle a click elsewhere in the menu", () => {
		expect(handleSortMenuClick({ target: { closest: () => null } })).toBe(
			false,
		);
		expect(settings.update).not.toHaveBeenCalled();
	});
});

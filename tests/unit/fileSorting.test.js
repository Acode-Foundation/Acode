import { getEntryComparator, normalizeSortOrder } from "utils/sortEntries";
import { describe, expect, it } from "vitest";

const names = (list) => list.map((entry) => entry.name);

function entries() {
	return [
		{ name: "beta.txt", isFile: true, size: 300, modifiedDate: 1000 },
		{ name: "alpha", isDirectory: true, size: 0, modifiedDate: 3000 },
		{ name: "zeta.txt", isFile: true, size: 100, modifiedDate: 2000 },
		{ name: "Gamma.md", isFile: true, size: 200, modifiedDate: 500 },
	];
}

const sorted = (list, sortBy, sortOrder = "asc") =>
	names([...list].sort(getEntryComparator(sortBy, sortOrder)));

describe("normalizeSortOrder", () => {
	it("accepts only descending and defaults to ascending", () => {
		expect(normalizeSortOrder("desc")).toBe("desc");
		expect(normalizeSortOrder("asc")).toBe("asc");
		expect(normalizeSortOrder(undefined)).toBe("asc");
		expect(normalizeSortOrder("sideways")).toBe("asc");
	});
});

describe("getEntryComparator", () => {
	it("returns nothing only when sorting is explicitly off", () => {
		expect(getEntryComparator("none", "asc")).toBeNull();
	});

	it("sorts by name when the saved settings have no field yet", () => {
		// Settings are only filled in at the top level on upgrade, so an existing
		// install reaches here with `sortBy` undefined. That must not turn
		// alphabetical sorting off.
		expect(sorted(entries(), undefined)).toEqual([
			"alpha",
			"beta.txt",
			"Gamma.md",
			"zeta.txt",
		]);
		expect(sorted(entries(), null)).toEqual([
			"alpha",
			"beta.txt",
			"Gamma.md",
			"zeta.txt",
		]);
	});

	it("orders by name, ignoring case", () => {
		expect(sorted(entries(), "name")).toEqual([
			"alpha",
			"beta.txt",
			"Gamma.md",
			"zeta.txt",
		]);
	});

	it("orders by name descending", () => {
		expect(sorted(entries(), "name", "desc")).toEqual([
			"zeta.txt",
			"Gamma.md",
			"beta.txt",
			"alpha",
		]);
	});

	it("orders by size", () => {
		expect(sorted(entries(), "size")).toEqual([
			"alpha",
			"zeta.txt",
			"Gamma.md",
			"beta.txt",
		]);
	});

	it("orders by size descending", () => {
		expect(sorted(entries(), "size", "desc")).toEqual([
			"beta.txt",
			"Gamma.md",
			"zeta.txt",
			"alpha",
		]);
	});

	it("orders by modification date", () => {
		expect(sorted(entries(), "date")).toEqual([
			"Gamma.md",
			"beta.txt",
			"zeta.txt",
			"alpha",
		]);
	});

	it("accepts Date objects as well as timestamps", () => {
		const list = [
			{ name: "new.txt", modifiedDate: new Date(5000) },
			{ name: "old.txt", modifiedDate: 1000 },
		];
		expect(sorted(list, "date", "desc")).toEqual(["new.txt", "old.txt"]);
	});

	it("orders by extension and groups files without one first", () => {
		expect(sorted(entries(), "type")).toEqual([
			"alpha",
			"Gamma.md",
			"beta.txt",
			"zeta.txt",
		]);
	});

	it("breaks ties by name so the order is stable", () => {
		const list = [
			{ name: "b.txt", size: 10 },
			{ name: "a.txt", size: 10 },
		];
		expect(sorted(list, "size")).toEqual(["a.txt", "b.txt"]);
	});

	it("sorts entries without a reported size last, not as empty files", () => {
		const list = [
			{ name: "known.txt", size: 10 },
			{ name: "unknown.txt" },
			{ name: "empty.txt", size: 0 },
		];
		expect(sorted(list, "size")).toEqual([
			"empty.txt",
			"known.txt",
			"unknown.txt",
		]);
	});

	it("puts entries without a date last in both directions", () => {
		const list = [
			{ name: "dated.txt", modifiedDate: 1000 },
			{ name: "undated.txt" },
		];
		expect(sorted(list, "date")).toEqual(["dated.txt", "undated.txt"]);
		expect(sorted(list, "date", "desc")).toEqual(["dated.txt", "undated.txt"]);
	});
});

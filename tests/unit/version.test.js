import { describe, expect, it } from "vitest";
import { compareVersions, isVersionGreater, parseVersion } from "utils/version";

describe("utils/version", () => {
	it("parses strict x.y.z versions", () => {
		expect(parseVersion("1.2.3")).toEqual([1, 2, 3]);
		expect(parseVersion("v1.2.3")).toEqual([1, 2, 3]);
		expect(parseVersion("1.2")).toBeNull();
		expect(parseVersion("1.2.x")).toBeNull();
	});

	it("compares versions", () => {
		expect(compareVersions("1.2.0", "1.1.9")).toBe(1);
		expect(compareVersions("1.1.1", "1.1.1")).toBe(0);
		expect(compareVersions("1.0.0", "1.1.1")).toBe(-1);
	});

	it("only treats newer versions as upgrades", () => {
		expect(isVersionGreater("1.1.2", "1.1.1")).toBe(true);
		expect(isVersionGreater("1.2.0", "1.1.9")).toBe(true);
		expect(isVersionGreater("1.1.1", "1.1.1")).toBe(false);
		expect(isVersionGreater("1.0.0", "1.1.1")).toBe(false);
	});
});

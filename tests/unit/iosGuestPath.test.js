import iosGuestPath from "lib/iosGuestPath";
import { beforeEach, describe, expect, it } from "vitest";

describe("iosGuestPath", () => {
	beforeEach(() => {
		globalThis.Bridge = {
			file: { dataDirectory: "file:///app/Library/NoCloud/" },
		};
	});

	it.each([
		["file:///app/Documents/demo#1", "/app/Documents/demo#1"],
		["file:///app/Library/NoCloud/public/100%done", "/public/100%done"],
		[
			"file:///app/Library/NoCloud/public/literal%20folder",
			"/public/literal%20folder",
		],
		["file:///app/Library/NoCloud/public", "/public"],
	])("keeps decoded file URL %s as %s", (url, expected) => {
		expect(iosGuestPath(url)).toBe(expected);
	});

	it("decodes Alpine URLs exactly once", () => {
		const url = `alpine://localhost/root/${encodeURIComponent("a b#1%20")}`;
		expect(iosGuestPath(url)).toBe("/root/a b#1%20");
		expect(iosGuestPath("alpine://localhost")).toBe("/");
	});

	it("matches Terminal Public when the native URL is encoded", () => {
		globalThis.Bridge.file.dataDirectory = "file:///My%20App/Library/NoCloud/";
		expect(iosGuestPath("file:///My App/Library/NoCloud/public/x")).toBe(
			"/public/x",
		);
	});
});

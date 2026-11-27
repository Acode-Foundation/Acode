import { describe, expect, it } from "vitest";
import launchAppWithFileArgs from "../../src/native/launchAppWithFileArgs";

describe("launchAppWithFileArgs", () => {
	it("rejects missing options, a class without an app and empty launches", () => {
		expect(launchAppWithFileArgs(undefined as never)).toBeTypeOf("string");
		expect(launchAppWithFileArgs({ className: "a.B" })).toMatch(
			/requires "app"/,
		);
		expect(launchAppWithFileArgs({ app: " ", fileUris: [" "] })).toMatch(
			/nothing to launch/,
		);
	});

	it("trims values, dedupes file URIs and applies defaults", () => {
		expect(
			launchAppWithFileArgs({
				app: " org.love2d.android ",
				fileUris: ["file:///a", " file:///a", "", "file:///b"],
				categories: [" LAUNCHER ", ""],
				flags: ["SINGLE_TOP", 4],
			}),
		).toEqual({
			app: "org.love2d.android",
			className: "",
			fileUri: "",
			fileUris: ["file:///a", "file:///b"],
			filename: "",
			clipLabel: "",
			mimeType: "",
			action: "",
			categories: ["LAUNCHER"],
			flags: ["SINGLE_TOP", 4],
			extras: null,
			writeAccess: false,
			attachAsStream: false,
			newTask: true,
		});
	});
});

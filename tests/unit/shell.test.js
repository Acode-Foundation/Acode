import { describe, expect, it } from "vitest";
import { quotePosixShellArg } from "utils/shell";

describe("quotePosixShellArg", () => {
	it("quotes spaces and shell metacharacters as literal text", () => {
		expect(quotePosixShellArg("/srv/project $(touch bad)")).toBe(
			"'/srv/project $(touch bad)'",
		);
	});

	it("escapes embedded single quotes", () => {
		expect(quotePosixShellArg("/srv/user's project")).toBe(
			`'/srv/user'"'"'s project'`,
		);
	});

	it("rejects line-oriented control characters", () => {
		expect(() => quotePosixShellArg("/srv/project\ncommand")).toThrow(
			"control characters",
		);
	});
});

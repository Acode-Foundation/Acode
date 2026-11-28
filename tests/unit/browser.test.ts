import browser from "native/browser";
import { afterEach, expect, test, vi } from "vitest";

vi.mock("lib/settings", () => ({ default: { value: { appTheme: "system" } } }));
vi.mock("theme/list", () => ({
	default: { get: () => ({ toJSON: () => ({ type: "dark" }) }) },
}));

afterEach(() => vi.unstubAllGlobals());

test.each([
	false,
	true,
])("forwards preview isolation and errors to the native bridge (ephemeral: %s)", (ephemeral) => {
	const exec = vi.fn();
	const onError = vi.fn();
	vi.stubGlobal("Bridge", { exec });
	if (ephemeral)
		browser.open("http://localhost:3000", false, { ephemeral, onError });
	else browser.open("http://localhost:3000");
	expect(exec).toHaveBeenCalledWith(
		expect.any(Function),
		ephemeral ? onError : console.error,
		"Browser",
		"open",
		["http://localhost:3000", { type: "dark" }, false, ephemeral],
	);
	if (ephemeral) {
		exec.mock.calls[0][1]("Unable to present");
		expect(onError).toHaveBeenCalledWith("Unable to present");
	}
});

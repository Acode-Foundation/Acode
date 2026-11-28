import openTerminalLink from "components/terminal/openTerminalLink";
import confirm from "dialogs/confirm";
import browser from "native/browser";
import helpers from "utils/helpers";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("dialogs/confirm", () => ({ default: vi.fn() }));
vi.mock("native/browser", () => ({ default: { open: vi.fn() } }));
vi.mock("utils/helpers", () => ({ default: { error: vi.fn() } }));

beforeEach(() => {
	vi.clearAllMocks();
	browser.open.mockReset();
	helpers.error.mockReset();
	vi.stubGlobal("Bridge", { platformId: "ios" });
	vi.stubGlobal("system", { openInBrowser: vi.fn() });
	confirm.mockResolvedValue(true);
});
afterEach(() => vi.unstubAllGlobals());

test.each([
	[
		"http://localhost:3000/path?q=1#section",
		"http://localhost:3000/path?q=1#section",
	],
	["http://127.0.0.1:3000", "http://127.0.0.1:3000/"],
	["http://0.0.0.0:3000", "http://127.0.0.1:3000/"],
	["http://[::1]:3000", "http://[::1]:3000/"],
	["http://[::]:3000", "http://[::1]:3000/"],
	["https://localhost:3000", "https://localhost:3000/"],
	["http://LOCALHOST.:3000", "http://localhost.:3000/"],
	["http://user:pass@localhost:3000", "http://user:pass@localhost:3000/"],
])("iOS previews local server %s without leaving Acode", async (uri, target) => {
	await openTerminalLink(uri);
	expect(browser.open).toHaveBeenCalledWith(target, false, {
		ephemeral: true,
		onError: expect.any(Function),
	});
	expect(system.openInBrowser).not.toHaveBeenCalled();
	expect(confirm).not.toHaveBeenCalled();
});

test.each([
	["ios", "https://localhost.example.com", false],
	["ios", "http://localhost@evil.example", false],
	["ios", "http://127.0.0.1.evil.example", false],
	["ios", "http://notlocalhost", false],
	["ios", "http://localhost:3000", true],
	["android", "http://localhost:3000", false],
])("preserves external routing for %s %s (remote: %s)", async (platform, uri, remote) => {
	Bridge.platformId = platform;
	await openTerminalLink(uri, remote);
	expect(browser.open).not.toHaveBeenCalled();
	expect(system.openInBrowser).toHaveBeenCalledWith(uri);
});

test("cancelled external navigation does not open a browser", async () => {
	confirm.mockResolvedValue(false);
	await openTerminalLink("https://example.com");
	expect(browser.open).not.toHaveBeenCalled();
	expect(system.openInBrowser).not.toHaveBeenCalled();
});

test.each([
	false,
	true,
])("reports preview failures without leaving Acode (throws: %s)", async (throws) => {
	const error = new Error("A browser cannot be presented right now");
	helpers.error.mockImplementation(function () {
		expect(this).toBe(helpers);
	});
	browser.open.mockImplementation((url, isConsole, options) => {
		if (throws) throw error;
		options.onError(error);
	});
	await openTerminalLink("http://localhost:3000");
	expect(helpers.error).toHaveBeenCalledWith(error);
	expect(system.openInBrowser).not.toHaveBeenCalled();
});

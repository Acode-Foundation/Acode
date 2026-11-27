// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	configuration: vi.fn(),
	banner: vi.fn(),
	platform: { isIOS: true },
	resize: new Map(),
}));
vi.mock("lib/platform", () => ({ default: mocks.platform }));
vi.mock("lib/startAd", () => ({ setBannerKeyboardVisible: mocks.banner }));
vi.mock("lib/systemConfiguration", () => ({
	getSystemConfiguration: mocks.configuration,
	HARDKEYBOARDHIDDEN_NO: 1,
}));
vi.mock("handlers/windowResize", () => ({
	default: { on: (name, listener) => mocks.resize.set(name, listener) },
}));
vi.mock("utils/keyboardEvent", () => ({
	default: (type, init) => new KeyboardEvent(type, init),
}));

let events;
beforeEach(async () => {
	vi.resetModules();
	vi.clearAllMocks();
	mocks.resize.clear();
	mocks.platform.isIOS = true;
	vi.stubGlobal("innerHeight", 1000);
	const listeners = vi.spyOn(document, "addEventListener");
	listeners.mockImplementation(() => {});
	const { default: keyboard } = await import("handlers/keyboard");
	listeners.mock.calls.find(([name]) => name === "deviceready")[1]();
	events = [];
	for (const name of [
		"keyboardShowStart",
		"keyboardShow",
		"keyboardHideStart",
		"keyboardHide",
	])
		keyboard.on(name, () => events.push(name));
});

afterEach(() => {
	document.body.replaceChildren();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

it("reveals the iOS caret when software and hardware keyboards coexist", async () => {
	await resize(650, { hardKeyboardHidden: 1, keyboardHeight: 350 });
	expect(events).toEqual(["keyboardShowStart", "keyboardShow"]);
	expect(mocks.banner).toHaveBeenLastCalledWith(true);
});

it("uses native iOS visibility after rotation changes the available height", async () => {
	await resize(650, { hardKeyboardHidden: 2, keyboardHeight: 350 });
	const input = document.createElement("input");
	document.body.append(input);
	input.focus();
	events.length = 0;
	await resize(800, { hardKeyboardHidden: 2, keyboardHeight: 0 });
	expect(events).toEqual(["keyboardHideStart", "keyboardHide"]);
	expect(document.activeElement).not.toBe(input);
	expect(mocks.banner).toHaveBeenLastCalledWith(false);
});

it("ignores the compact iOS hardware-keyboard toolbar", async () => {
	await resize(950, { hardKeyboardHidden: 1, keyboardHeight: 50 });
	expect(events).toEqual([]);
	expect(mocks.banner).not.toHaveBeenCalled();
});

it("keeps Android hardware-keyboard resize behavior", async () => {
	mocks.platform.isIOS = false;
	await resize(650, { hardKeyboardHidden: 1, keyboardHeight: 350 });
	expect(events).toEqual([]);
	expect(mocks.banner).not.toHaveBeenCalled();
});

it("keeps Android software-keyboard show and hide events", async () => {
	mocks.platform.isIOS = false;
	await resize(650, { hardKeyboardHidden: 2, keyboardHeight: 350 });
	await resize(1000, { hardKeyboardHidden: 2, keyboardHeight: 0 });
	expect(events).toEqual([
		"keyboardShowStart",
		"keyboardShow",
		"keyboardHideStart",
		"keyboardHide",
	]);
});

async function resize(height, configuration) {
	vi.stubGlobal("innerHeight", height);
	mocks.configuration.mockResolvedValue(configuration);
	await mocks.resize.get("resizeStart")();
	await mocks.resize.get("resize")();
}

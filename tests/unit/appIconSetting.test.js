// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import { transformSync } from "@babel/core";
import DOMPurify from "dompurify";
import tag from "html-tag-js";
import Ref from "html-tag-js/ref";
import { APP_ICONS } from "lib/appIcons";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	settings: { value: { appIcon: "default" }, update: vi.fn() },
	config: { HAS_PRO: false },
	reward: vi.fn(),
	purchase: vi.fn(),
	external: false,
	toast: vi.fn(),
	error: vi.fn(),
}));
vi.mock("lib/settings", () => ({ default: mocks.settings }));
vi.mock("lib/config", () => ({ default: mocks.config }));
vi.mock("lib/restoreTheme", () => ({ default: vi.fn() }));
vi.mock("components/checkbox", () => ({
	default: () => document.createElement("input"),
}));
vi.mock("components/toast", () => ({ default: mocks.toast }));
vi.mock("lib/adRewards", () => ({
	default: { canShowAds: () => !mocks.config.HAS_PRO },
}));
vi.mock("lib/rewardedAd", () => ({ default: mocks.reward }));
vi.mock("lib/removeAds", () => ({ requestProPurchase: mocks.purchase }));
vi.mock("utils/helpers", () => ({
	default: {
		error: mocks.error,
		shouldAllowExternalPurchase: () => mocks.external,
		promisify: (fn, ...args) =>
			new Promise((resolve, reject) => fn(...args, resolve, reject)),
	},
}));
import actionStack from "lib/actionStack";
import selectAppIcon from "lib/appIconSelection";
import restoreTheme from "lib/restoreTheme";

createRequire(path.resolve("package.json"))("html-tag-js/polyfill");

const compiled = new Map();

// Use the existing JSX transform, with module dependencies supplied by each test.
function loadModule(name, dependencies, globals = {}) {
	const filename = path.resolve("src/pages/appIconSetting", `${name}.js`);
	if (!compiled.has(filename)) {
		compiled.set(
			filename,
			transformSync(readFileSync(filename, "utf8"), {
				filename,
				babelrc: false,
				configFile: false,
				presets: [
					[
						"@babel/preset-env",
						{ targets: { node: "current" }, modules: "commonjs" },
					],
				],
				plugins: [
					"html-tag-js/jsx/syntax-parser.js",
					"html-tag-js/jsx/jsx-to-tag.js",
				],
			}).code,
		);
	}
	const exports = {};
	vm.runInNewContext(
		compiled.get(filename),
		{
			exports,
			tag,
			AbortController,
			document,
			setTimeout,
			require(id) {
				if (!(id in dependencies)) throw new Error(`Unexpected import: ${id}`);
				return dependencies[id]();
			},
			...globals,
		},
		{ filename },
	);
	return exports;
}

function preloadHarness() {
	const images = [];
	const open = vi.fn(async () => "opened");
	const entry = loadModule(
		"index",
		{
			"lib/appIcons": () => ({ APP_ICONS }),
			"./appIconSetting": () => ({ __esModule: true, default: open }),
		},
		{
			Image: class {
				decode = vi.fn().mockResolvedValue(undefined);
				constructor() {
					images.push(this);
				}
			},
		},
	);
	return { ...entry, images, open };
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.clearAllMocks();
	actionStack.setMark();
	vi.stubGlobal("app", document.body);
	vi.stubGlobal("tag", tag);
	vi.stubGlobal("strings", {
		"app icon": "App icon",
		"app icon change warning":
			"The app will exit after the app icon is changed.",
		"loading...": "Loading...",
		"app icon changed": "Changed",
		"confirm app icon reward": "Watch?",
		"rewarded ad incomplete": "Incomplete",
		close: "Close",
		ok: "OK",
		cancel: "Cancel",
	});
	vi.stubGlobal("system", { setAppIcon: vi.fn((id, success) => success()) });
	mocks.config.HAS_PRO = false;
	mocks.external = false;
	mocks.settings.value.appIcon = "default";
	mocks.settings.update.mockImplementation(async ({ appIcon }) => {
		mocks.settings.value.appIcon = appIcon;
	});
	mocks.reward.mockResolvedValue(true);
	mocks.purchase.mockResolvedValue(false);
});
afterEach(() => {
	actionStack.clearFromMark();
	vi.runAllTimers();
	actionStack.unfreeze();
	vi.restoreAllMocks();
	vi.useRealTimers();
	vi.unstubAllGlobals();
	document.body.replaceChildren();
});

it("does no startup work and shares pending and successful preloads without opening", async () => {
	const h = preloadHarness();
	expect(h.images).toHaveLength(0);
	const first = h.preloadAppIconSetting();
	const second = h.preloadAppIconSetting();
	expect(h.images.map((image) => image.src)).toEqual(
		APP_ICONS.map((i) => i.image),
	);
	for (const image of h.images) image.onload();
	await Promise.all([first, second]);
	await h.preloadAppIconSetting();
	expect(h.images).toHaveLength(APP_ICONS.length);
	expect(h.open).not.toHaveBeenCalled();
	for (const image of h.images) {
		expect(image.decode).toHaveBeenCalledOnce();
		expect(image.onload).toBeNull();
		expect(image.onerror).toBeNull();
	}
});

it("retries only failed previews when opening the picker", async () => {
	const h = preloadHarness();
	const first = h.preloadAppIconSetting();
	h.images[0].onerror(new Error("Unavailable image"));
	for (const image of h.images.slice(1)) image.onload();
	await first;
	await expect(h.default()).resolves.toBe("opened");
	expect(h.images).toHaveLength(APP_ICONS.length + 1);
	expect(h.images.at(-1).src).toBe(APP_ICONS[0].image);
	expect(h.images[0].onerror).toBeNull();
	h.images.at(-1).onload();
	await h.preloadAppIconSetting();
});

it("opens while previews are pending and falls back when decoding is unavailable or fails", async () => {
	const h = preloadHarness();
	const preload = h.preloadAppIconSetting();
	h.images[0].decode = undefined;
	h.images[1].decode.mockRejectedValue(new Error("Decode failed"));
	await expect(h.default("argument")).resolves.toBe("opened");
	expect(h.open).toHaveBeenCalledExactlyOnceWith("argument");
	for (const image of h.images) image.onload();
	await preload;
	await h.preloadAppIconSetting();
	expect(h.images).toHaveLength(APP_ICONS.length);
});

function pendingConfirm() {
	const dialogs = document.querySelectorAll(".prompt.confirm:not(.hide)");
	return dialogs[dialogs.length - 1];
}

function confirmSelection(accept = true) {
	const buttons = pendingConfirm().querySelectorAll(".button-container button");
	buttons[accept ? 1 : 0].click();
}

function dialogHarness() {
	const trigger = document.createElement("button");
	app.append(trigger);
	trigger.focus();
	const loader = loadModule(
		"../../dialogs/loader",
		{
			"components/tailSpin.js": () => () => "<svg></svg>",
			dompurify: () => DOMPurify,
			"html-tag-js/ref": () => Ref,
			"lib/actionStack": () => actionStack,
			"lib/restoreTheme": () => restoreTheme,
		},
		{ app, strings, clearTimeout },
	).default;
	vi.spyOn(loader, "create");
	vi.spyOn(loader, "destroy");
	let selection;
	const select = vi.fn((iconId, options) => {
		selection = options;
		return selectAppIcon(iconId, options);
	});
	const module = loadModule(
		"appIconSetting",
		{
			"dialogs/style.scss": () => ({}),
			"./appIconSetting.scss": () => ({}),
			"dialogs/loader": () => loader,
			"lib/actionStack": () => actionStack,
			"lib/appIconSelection": () => select,
			"lib/appIcons": () => ({ APP_ICONS }),
			"lib/settings": () => mocks.settings,
			"lib/restoreTheme": () => restoreTheme,
		},
		{ app, strings },
	);
	const closed = module.default();
	const dialog = app.querySelector(".app-icon-dialog");
	return {
		open: module.default,
		closed,
		dialog,
		get selection() {
			return selection;
		},
		loader,
		trigger,
		close: dialog.querySelector(".button-container button"),
		click(id = "pixel_party") {
			app.querySelector(`.app-icon-dialog [data-icon="${id}"] img`).click();
			return select.mock.results.at(-1)?.value;
		},
	};
}

it("opens one complete grid and closes only after native success, preserving the toast", async () => {
	const append = vi.spyOn(app, "append");
	append.mockImplementation((...nodes) => {
		const [dialog] = nodes;
		if (dialog.classList.contains("app-icon-dialog")) {
			expect(dialog.querySelectorAll("img")).toHaveLength(APP_ICONS.length);
			expect(dialog.querySelector(".current").dataset.icon).toBe("default");
		}
		for (const node of nodes) app.appendChild(node);
	});
	mocks.config.HAS_PRO = true;
	const h = dialogHarness();
	expect(h.open()).toBe(h.closed);
	expect(actionStack.length).toBe(1);
	expect(h.dialog.getAttribute("aria-modal")).toBe("true");
	expect(document.activeElement.getAttribute("aria-pressed")).toBe("true");
	expect(h.dialog.querySelector(".app-icon-list").textContent.trim()).toBe("");
	for (const icon of APP_ICONS) {
		const button = h.dialog.querySelector(`[data-icon="${icon.id}"]`);
		expect(button.getAttribute("aria-label")).toBe(icon.label);
		expect(button.querySelector("img").alt).toBe("");
	}
	expect(
		[...h.dialog.querySelectorAll("img")].every((i) => i.loading !== "lazy"),
	).toBe(true);
	await h.click("default");
	expect(h.loader.create).not.toHaveBeenCalled();
	let applied;
	system.setAppIcon.mockImplementation((id, success) => {
		applied = success;
	});
	const pending = h.click();
	expect(h.dialog.classList.contains("hide")).toBe(false);
	// The exit warning is confirmed before the loader is shown.
	expect(pendingConfirm()).toBeTruthy();
	expect(h.loader.create).not.toHaveBeenCalled();
	confirmSelection();
	await vi.waitFor(() => expect(applied).toBeTypeOf("function"));
	expect(h.loader.create).toHaveBeenCalledExactlyOnceWith("App icon", "Loading...");
	expect(h.dialog.inert).toBe(true);
	expect(document.querySelector("#__loader button")).toBeNull();
	await actionStack.pop();
	h.close.dispatchEvent(
		new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
	);
	expect(h.selection.signal.aborted).toBe(false);
	expect(actionStack.length).toBe(1);
	applied();
	await pending;
	expect(mocks.settings.value.appIcon).toBe("pixel_party");
	expect(mocks.toast).toHaveBeenCalledExactlyOnceWith("Changed");
	vi.runAllTimers();
	await h.closed;
	expect(h.dialog.isConnected).toBe(false);
	expect(h.loader.destroy).toHaveBeenCalledOnce();
	expect(document.querySelector("#__loader, #__loader-mask")).toBeNull();
	expect(document.activeElement).toBe(h.trigger);
});

it.each([
	"success",
	"failure",
])("keeps a reopened picker's loader active across old cleanup until %s", async (outcome) => {
	mocks.config.HAS_PRO = true;
	const h = dialogHarness();
	const first = h.click();
	confirmSelection();
	await first;
	const previousLoader = document.querySelector("#__loader");
	expect(previousLoader.classList.contains("hide")).toBe(true);
	await vi.advanceTimersByTimeAsync(180);
	await h.closed;

	const closed = h.open();
	const dialog = app.querySelector(".app-icon-dialog");
	let finish;
	system.setAppIcon.mockImplementationOnce((id, success, failure) => {
		finish = () => (outcome === "success" ? success() : failure("Failed"));
	});
	const pending = h.click("solar_flare");
	confirmSelection();
	await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
	try {
		const currentLoader = document.querySelector("#__loader");
		expect(currentLoader).not.toBeNull();
		expect(currentLoader).not.toBe(previousLoader);
		expect(currentLoader.classList.contains("hide")).toBe(false);
		await vi.advanceTimersByTimeAsync(120);
		expect(document.querySelector("#__loader")).toBe(currentLoader);
		expect(document.querySelectorAll("#__loader-mask")).toHaveLength(1);
		expect(dialog.inert).toBe(true);
		await actionStack.pop();
		dialog
			.querySelector(".button-container button")
			.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
			);
		expect(h.selection.signal.aborted).toBe(false);
		expect(actionStack.length).toBe(1);
	} finally {
		finish();
		await pending;
	}
	await vi.advanceTimersByTimeAsync(300);
	expect(document.querySelector("#__loader, #__loader-mask")).toBeNull();
	if (outcome === "failure") {
		expect(dialog.inert).toBe(false);
		expect(
			[...dialog.querySelectorAll("button")].every(
				(button) => !button.disabled,
			),
		).toBe(true);
		expect(mocks.error).toHaveBeenCalledExactlyOnceWith("Failed");
		await actionStack.pop();
		await vi.advanceTimersByTimeAsync(180);
	}
	await closed;
	expect(actionStack.length).toBe(0);
	expect(mocks.toast).toHaveBeenCalledTimes(outcome === "success" ? 2 : 1);
});

it("replaces loader content and cancellation without breaking hide and show", async () => {
	const h = dialogHarness();
	const oldCancel = vi.fn();
	const cancel = vi.fn();
	h.loader.create("Old title", "Old message", {
		timeout: 100,
		oncancel: oldCancel,
	});
	await vi.advanceTimersByTimeAsync(50);
	const replacement = h.loader.create("New title", "New message", {
		timeout: 200,
		oncancel: cancel,
	});
	const dialog = document.querySelector("#__loader");
	expect(dialog.querySelector(".title").textContent.trim()).toBe("New title");
	expect(dialog.textContent).toContain("New message");
	replacement.setTitle("Updated title");
	replacement.setMessage("Updated message");
	expect(dialog.querySelector(".title").textContent.trim()).toBe(
		"Updated title",
	);
	expect(dialog.textContent).toContain("Updated message");
	replacement.hide();
	expect(document.querySelector("#__loader, #__loader-mask")).toBeNull();
	replacement.show();
	expect(document.querySelector("#__loader")).toBe(dialog);
	await vi.advanceTimersByTimeAsync(50);
	expect(dialog.querySelector("button")).toBeNull();
	await vi.advanceTimersByTimeAsync(150);
	dialog.querySelector("button").click();
	expect(cancel).toHaveBeenCalledOnce();
	expect(oldCancel).not.toHaveBeenCalled();
	await vi.advanceTimersByTimeAsync(300);
	replacement.show();
	expect(document.querySelector("#__loader, #__loader-mask")).toBeNull();
	await actionStack.pop();
	await vi.advanceTimersByTimeAsync(180);
	await h.closed;
	expect(restoreTheme.mock.calls).toEqual([[true], [true], [], []]);
});

it("locks tiles before confirmation and shows the loader through reward and application", async () => {
	let reward, applied;
	const h = dialogHarness();
	mocks.reward.mockImplementation(() => {
		expect(h.loader.create).toHaveBeenCalledOnce();
		return new Promise((resolve) => {
			reward = resolve;
		});
	});
	system.setAppIcon.mockImplementation((id, success) => {
		applied = success;
	});
	const pending = h.click();
	h.click("solar_flare");
	expect(actionStack.length).toBe(2);
	expect(
		h.dialog.querySelector(".app-icon-list").getAttribute("aria-busy"),
	).toBe("true");
	expect(
		[...h.dialog.querySelectorAll(".app-icon-item")].every(
			(button) => button.disabled,
		),
	).toBe(true);
	expect(h.loader.create).not.toHaveBeenCalled();
	expect(h.loader.destroy).not.toHaveBeenCalled();
	expect(mocks.reward).not.toHaveBeenCalled();
	// The exit warning comes first, then the rewarded-ad prompt.
	confirmSelection();
	await vi.waitFor(() => expect(pendingConfirm()).toBeTruthy());
	confirmSelection();
	await vi.waitFor(() => expect(reward).toBeTypeOf("function"));
	h.click("solar_flare");
	expect(mocks.reward).toHaveBeenCalledOnce();
	reward(true);
	await vi.waitFor(() => expect(applied).toBeTypeOf("function"));
	expect(h.loader.create).toHaveBeenCalledOnce();
	expect(h.loader.destroy).not.toHaveBeenCalled();
	expect(system.setAppIcon.mock.calls[0][0]).toBe("pixel_party");
	applied();
	await pending;
	vi.runAllTimers();
	await h.closed;
	expect(h.loader.destroy).toHaveBeenCalledOnce();
});

it("never shows a loader when the picker closes during confirmation", async () => {
	const h = dialogHarness();
	const pending = h.click();
	h.close.click();
	await pending;
	vi.runAllTimers();
	await h.closed;
	expect(h.loader.create).not.toHaveBeenCalled();
	expect(h.loader.destroy).not.toHaveBeenCalled();
	expect(mocks.reward).not.toHaveBeenCalled();
	expect(system.setAppIcon).not.toHaveBeenCalled();
	expect(actionStack.length).toBe(0);
});

it.each([
	"back",
	"outside",
	"close",
	"escape",
])("dismisses through %s once and preserves a reopened picker's handler", async (method) => {
	const h = dialogHarness();
	const id = h.dialog.getAttribute("aria-labelledby").replace(/-title$/, "");
	const staleClose = actionStack.get(id).action;
	if (method === "back") await actionStack.pop();
	if (method === "outside") h.dialog.nextElementSibling.click();
	if (method === "close") h.close.click();
	if (method === "escape")
		h.close.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
		);
	staleClose();
	vi.runAllTimers();
	await h.closed;
	expect(actionStack.length).toBe(0);
	expect(document.querySelectorAll(".prompt, .mask")).toHaveLength(0);
	expect(restoreTheme.mock.calls).toEqual([[true], []]);
	expect(document.activeElement).toBe(h.trigger);
	const next = h.open();
	staleClose();
	expect(actionStack.length).toBe(1);
	expect(
		app.querySelector(".app-icon-dialog").getAttribute("aria-labelledby"),
	).not.toBe(`${id}-title`);
	await actionStack.pop();
	vi.runAllTimers();
	await next;
});

it.each([
	"back",
	"cancel",
	"reward failure",
	"native failure",
	"purchase",
])("keeps the picker and images usable after %s", async (outcome) => {
	if (outcome === "reward failure")
		mocks.reward.mockRejectedValueOnce(new Error("Unavailable"));
	if (outcome === "native failure")
		system.setAppIcon.mockImplementationOnce((id, ok, fail) => fail("Failed"));
	const h = dialogHarness();
	const images = [...h.dialog.querySelectorAll("img")];
	const pending = h.click(outcome === "purchase" ? "pro" : "pixel_party");
	// Every selection first confirms the exit warning.
	expect(actionStack.length).toBe(2);
	expect(h.loader.create).not.toHaveBeenCalled();
	if (outcome === "back") {
		await actionStack.pop();
	} else {
		confirmSelection(outcome !== "cancel");
		if (outcome === "reward failure" || outcome === "native failure") {
			// Rewarded-ad icons ask for the ad after the exit warning.
			await vi.waitFor(() => expect(pendingConfirm()).toBeTruthy());
			confirmSelection();
		}
	}
	await pending;
	vi.runAllTimers();
	const loaderCount = outcome === "back" || outcome === "cancel" ? 0 : 1;
	expect(h.loader.create).toHaveBeenCalledTimes(loaderCount);
	expect(h.loader.destroy).toHaveBeenCalledTimes(loaderCount);
	expect(actionStack.length).toBe(1);
	expect(h.dialog.classList.contains("hide")).toBe(false);
	expect(h.dialog.inert).toBe(false);
	expect(document.querySelector("#__loader, #__loader-mask")).toBeNull();
	expect(
		[...h.dialog.querySelectorAll("button")].every((b) => !b.disabled),
	).toBe(true);
	expect(mocks.settings.value.appIcon).toBe("default");
	for (const [i, image] of [...h.dialog.querySelectorAll("img")].entries())
		expect(image).toBe(images[i]);
	mocks.config.HAS_PRO = true;
	const applied = h.click();
	confirmSelection();
	await applied;
	vi.runAllTimers();
	await h.closed;
	expect(mocks.settings.value.appIcon).toBe("pixel_party");
});

it("leaves the external Pro flow's loader under its own control", async () => {
	mocks.external = true;
	const h = dialogHarness();
	mocks.purchase.mockImplementation(async () => {
		h.loader.create("Login", "Loading...");
	});
	const pending = h.click("pro");
	confirmSelection();
	await pending;
	expect(h.loader.create).toHaveBeenCalledExactlyOnceWith("Login", "Loading...");
	expect(h.loader.destroy).not.toHaveBeenCalled();
	expect(h.dialog.inert).toBe(false);
	expect(document.querySelector("#__loader .title").textContent.trim()).toBe("Login");
	h.loader.destroy();
	vi.runAllTimers();
	await actionStack.pop();
	vi.runAllTimers();
	await h.closed;
	expect(h.loader.destroy).toHaveBeenCalledOnce();
});

it("cleans up a pending reward and ignores late callbacks after reopening", async () => {
	let reward;
	mocks.reward.mockImplementation(
		() =>
			new Promise((resolve) => {
				reward = resolve;
			}),
	);
	const h = dialogHarness();
	const pending = h.click();
	confirmSelection();
	await vi.waitFor(() => expect(pendingConfirm()).toBeTruthy());
	confirmSelection();
	await vi.waitFor(() => expect(reward).toBeTypeOf("function"));
	expect(h.loader.create).toHaveBeenCalledOnce();
	h.selection.onChange();
	vi.runAllTimers();
	await h.closed;
	expect(h.loader.destroy).toHaveBeenCalledOnce();
	const next = h.open();
	reward(true);
	await pending;
	h.selection.onChange();
	expect(h.loader.create).toHaveBeenCalledOnce();
	expect(h.loader.destroy).toHaveBeenCalledOnce();
	expect(system.setAppIcon).not.toHaveBeenCalled();
	expect(actionStack.length).toBe(1);
	expect(app.querySelector(".app-icon-dialog").classList.contains("hide")).toBe(
		false,
	);
	await actionStack.pop();
	vi.runAllTimers();
	await next;
});

it("wraps keyboard focus but lets Escape dismiss the top confirmation first", async () => {
	const h = dialogHarness();
	const first = h.dialog.querySelector("button");
	first.dispatchEvent(
		new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }),
	);
	expect(document.activeElement).toBe(h.close);
	h.close.dispatchEvent(
		new KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
	);
	expect(document.activeElement).toBe(first);
	const pending = h.click();
	expect(document.activeElement).toBe(h.close);
	const tab = new KeyboardEvent("keydown", {
		key: "Tab",
		bubbles: true,
		cancelable: true,
	});
	h.close.dispatchEvent(tab);
	expect(tab.defaultPrevented).toBe(false);
	h.close.dispatchEvent(
		new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
	);
	await pending;
	expect(actionStack.length).toBe(1);
	expect(h.selection.signal.aborted).toBe(false);
	h.close.click();
	vi.runAllTimers();
	await h.closed;
});

// @vitest-environment happy-dom
import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";
import installFullscreen from "../../src/platforms/ios/fullscreen";

const native = vi
	.fn<(active: boolean) => Promise<void>>()
	.mockResolvedValue(undefined);
let nativeOwner: Element | null = null;
const nativeRequest = vi.fn(function (this: Element) {
	nativeOwner = this;
	return Promise.resolve();
});
const nativeExit = vi.fn(async () => {
	nativeOwner = null;
});
const descriptors = [
	[document, "fullscreenElement"],
	[ShadowRoot.prototype, "fullscreenElement"],
	[document, "fullscreenEnabled"],
	[Element.prototype, "requestFullscreen"],
	[document, "exitFullscreen"],
	[HTMLElement.prototype, "showPopover"],
	[HTMLElement.prototype, "hidePopover"],
	[ShadowRoot.prototype, "styleSheets"],
	[CSSStyleRule.prototype, "selectorText"],
	[Document.prototype, "fullscreenElement"],
] as const;
const saved = descriptors.map(([target, key]) =>
	Object.getOwnPropertyDescriptor(target, key),
);
beforeAll(() => {
	Object.defineProperty(Document.prototype, "fullscreenElement", {
		configurable: true,
		get: () => nativeOwner,
	});
	Element.prototype.requestFullscreen = nativeRequest;
	document.exitFullscreen = nativeExit;
	const selectors = new WeakMap<CSSStyleRule, string>();
	const selector = Object.getOwnPropertyDescriptor(
		CSSStyleRule.prototype,
		"selectorText",
	)!.get!;
	Object.defineProperty(CSSStyleRule.prototype, "selectorText", {
		configurable: true,
		get() {
			return selectors.get(this) ?? selector.call(this);
		},
		set(value: string) {
			selectors.set(this, value);
		},
	});
	Object.defineProperty(ShadowRoot.prototype, "styleSheets", {
		configurable: true,
		get() {
			return [...this.querySelectorAll("style")]
				.map((style: HTMLStyleElement) => style.sheet)
				.filter(Boolean);
		},
	});
	HTMLElement.prototype.showPopover = function () {};
	HTMLElement.prototype.hidePopover = function () {};
	installFullscreen(native);
});
afterEach(async () => {
	await document.exitFullscreen();
	document.body.replaceChildren();
	document.head
		.querySelectorAll("[data-fullscreen-test]")
		.forEach((style) => style.remove());
	native.mockClear();
	nativeRequest.mockClear();
	nativeExit.mockClear();
});

test("retains native iframe ownership and delegates exit without changing the manual layout", async () => {
	const frame = document.createElement("iframe");
	document.body.append(frame);
	nativeOwner = frame;
	expect(document.fullscreenElement).toBe(frame);
	const target = document.createElement("div");
	document.body.append(target);
	await expect(target.requestFullscreen()).rejects.toThrow(/already active/);
	await document.exitFullscreen();
	expect(nativeExit).toHaveBeenCalledOnce();
	expect(native).not.toHaveBeenCalled();
	expect(document.fullscreenElement).toBeNull();
});

test("keeps manual fullscreen and exit working with unreadable cross-origin stylesheets", async () => {
	const target = document.createElement("div");
	document.body.append(target);
	const adopted = document.adoptedStyleSheets;
	const foreignSheet = new CSSStyleSheet();
	Object.defineProperty(foreignSheet, "cssRules", {
		get() {
			throw new DOMException("Cross-origin stylesheet", "SecurityError");
		},
	});
	document.adoptedStyleSheets = [foreignSheet];
	try {
		await target.requestFullscreen();
		expect(document.fullscreenElement).toBe(target);
		expect(target.hasAttribute("data-acode-fullscreen")).toBe(true);
		expect(target.style.width).toBe("100%");
		expect(native).toHaveBeenCalledWith(true);
		await document.exitFullscreen();
		expect(target.hasAttribute("data-acode-fullscreen")).toBe(false);
		expect(target.style.width).toBe("");
		expect(document.fullscreenElement).toBeNull();
		expect(native).toHaveBeenLastCalledWith(false);
		expect(nativeRequest).not.toHaveBeenCalled();
		expect(nativeExit).not.toHaveBeenCalled();
	} finally {
		document.adoptedStyleSheets = adopted;
	}
});

test("forces inline important layout and restores styles including changes made while fullscreen", async () => {
	const target = document.createElement("div");
	target.style.cssText =
		"position:absolute!important;left:30px!important;width:80px!important;height:70px!important;margin:12px;padding:9px;border:3px solid red;transform:translateX(5px)";
	document.body.append(target);
	await target.requestFullscreen();
	expect(target.style.width).toBe("100%");
	expect(target.style.left).toBe("0px");
	expect(target.style.marginTop).toBe("0px");
	expect(target.style.getPropertyPriority("width")).toBe("important");
	target.style.color = "blue";
	target.style.setProperty("width", "110px", "important");
	await vi.waitFor(() => expect(target.style.width).toBe("100%"));
	await document.exitFullscreen();
	expect(target.style.width).toBe("110px");
	expect(target.style.height).toBe("70px");
	expect(target.style.left).toBe("30px");
	expect(target.style.marginTop).toBe("12px");
	expect(target.style.paddingTop).toBe("9px");
	expect(target.style.borderTopWidth).toBe("3px");
	expect(target.style.transform).toBe("translateX(5px)");
	expect(target.style.color).toBe("blue");
});

test("adapts fullscreen CSS in place without changing attribute values or dynamic declarations", async () => {
	const style = document.createElement("style");
	style.dataset.fullscreenTest = "";
	style.textContent =
		'div:fullscreen > button { color:red } [data-label=":fullscreen"] { color:blue } @media (min-width:0px) { div:not(:fullscreen) { opacity:0.5 } }';
	document.head.append(style);
	const target = document.createElement("div");
	document.body.append(target);
	await target.requestFullscreen();
	const sheet = style.sheet!;
	const rule = sheet.cssRules[0] as CSSStyleRule;
	expect(rule.selectorText).toBe(
		"div:is(:fullscreen, [data-acode-fullscreen]) > button",
	);
	expect((sheet.cssRules[1] as CSSStyleRule).selectorText).toBe(
		'[data-label=":fullscreen"]',
	);
	const group = sheet.cssRules[2] as CSSGroupingRule;
	group.insertRule("div:fullscreen { opacity:1 }", 1);
	expect((group.cssRules[1] as CSSStyleRule).selectorText).toContain(
		"[data-acode-fullscreen]",
	);
	const adopted = new CSSStyleSheet();
	adopted.replaceSync("div:fullscreen { color:teal }");
	expect((adopted.cssRules[0] as CSSStyleRule).selectorText).toContain(
		"[data-acode-fullscreen]",
	);
	await adopted.replace("div:fullscreen { color:cyan }");
	expect((adopted.cssRules[0] as CSSStyleRule).selectorText).toContain(
		"[data-acode-fullscreen]",
	);
	rule.style.color = "green";
	sheet.insertRule("div:fullscreen { background:purple }", 3);
	expect((sheet.cssRules[3] as CSSStyleRule).selectorText).toContain(
		"[data-acode-fullscreen]",
	);
	style.textContent = "div:fullscreen { color:orange }";
	await vi.waitFor(() =>
		expect((style.sheet!.cssRules[0] as CSSStyleRule).selectorText).toContain(
			"[data-acode-fullscreen]",
		),
	);
	await document.exitFullscreen();
	expect(rule.style.color).toBe("green");
	expect(target.hasAttribute("data-acode-fullscreen")).toBe(false);
});

test.each([
	false,
	true,
])("Back consumes a native dialog close request, including cancellation: %s", async (prevented) => {
	const target = document.createElement("div");
	const dialog = document.createElement("dialog");
	target.append(dialog);
	document.body.append(target);
	await target.requestFullscreen();
	dialog.showModal();
	const cancel = vi.fn((event: Event) => {
		if (prevented) event.preventDefault();
	});
	dialog.addEventListener("cancel", cancel);
	const back = vi.fn();
	document.addEventListener("fullscreenbackbutton", back);
	try {
		document.dispatchEvent(new Event("fullscreenbackbutton"));
		expect(cancel).toHaveBeenCalledOnce();
		expect(dialog.open).toBe(prevented);
		expect(back).not.toHaveBeenCalled();
		expect(document.fullscreenElement).toBe(target);
	} finally {
		document.removeEventListener("fullscreenbackbutton", back);
		dialog.close();
	}
});
afterAll(() => {
	descriptors.forEach(([target, key], index) => {
		const descriptor = saved[index];
		if (descriptor) Object.defineProperty(target, key, descriptor);
		else Reflect.deleteProperty(target, key);
	});
});

test("enters and exits without moving the target or losing plugin style changes", async () => {
	const target = document.createElement("div");
	target.style.cssText = "top:12px;overflow:hidden";
	target.setAttribute("popover", "auto");
	document.body.append(target);
	const changed = vi.fn();
	document.addEventListener("fullscreenchange", changed);
	await target.requestFullscreen();
	expect(document.fullscreenElement).toBe(target);
	expect(target.parentElement).toBe(document.body);
	expect(target.hasAttribute("data-acode-fullscreen")).toBe(true);
	target.style.color = "red";
	await document.exitFullscreen();
	expect(document.fullscreenElement).toBeNull();
	expect(target.getAttribute("popover")).toBe("auto");
	expect(target.hasAttribute("data-acode-fullscreen")).toBe(false);
	expect(target.style.top).toBe("12px");
	expect(target.style.color).toBe("red");
	expect(changed).toHaveBeenCalledTimes(2);
	expect(native.mock.calls).toEqual([[true], [false]]);
	document.removeEventListener("fullscreenchange", changed);
});

test("serializes a pending entry and exit and protects a foreign owner", async () => {
	const target = document.createElement("div");
	const other = document.createElement("div");
	document.body.append(target, other);
	const entering = target.requestFullscreen();
	const exiting = document.exitFullscreen();
	await Promise.all([entering, exiting]);
	expect(document.fullscreenElement).toBeNull();
	await target.requestFullscreen();
	await expect(other.requestFullscreen()).rejects.toThrow(/already active/);
	expect(document.fullscreenElement).toBe(target);
	await target.requestFullscreen();
	expect(native.mock.calls).toEqual([[true], [false], [true]]);
});

test("retargets nested shadow owners and exits when an outer shadow ancestor is removed", async () => {
	const host = document.createElement("div");
	document.body.append(host);
	const outer = host.attachShadow({ mode: "open" });
	const inner = document.createElement("div");
	outer.append(inner);
	const shadow = inner.attachShadow({ mode: "open" });
	const target = document.createElement("div");
	shadow.append(target);
	await target.requestFullscreen();
	expect(document.fullscreenElement).toBe(host);
	expect(outer.fullscreenElement).toBe(inner);
	expect(shadow.fullscreenElement).toBe(target);
	inner.remove();
	await vi.waitFor(() =>
		expect(target.hasAttribute("data-acode-fullscreen")).toBe(false),
	);
	expect(document.fullscreenElement).toBeNull();
	expect(native).toHaveBeenLastCalledWith(false);
});

test("rolls back a failed native entry and rejects disconnected elements", async () => {
	const target = document.createElement("div");
	await expect(target.requestFullscreen()).rejects.toThrow(/connected/);
	expect(native).not.toHaveBeenCalled();
	document.body.append(target);
	native.mockRejectedValueOnce(new Error("App is backgrounded"));
	await expect(target.requestFullscreen()).rejects.toThrow(/backgrounded/);
	expect(document.fullscreenElement).toBeNull();
	expect(target.hasAttribute("popover")).toBe(false);
	expect(target.hasAttribute("data-acode-fullscreen")).toBe(false);
	await target.requestFullscreen();
	document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
	await vi.waitFor(() => expect(document.fullscreenElement).toBeNull());
});

test.each([
	"menu",
	"body",
	"game",
])("Back closes a shadow menu when focus is on %s", async (focus) => {
	const owner = document.createElement("div");
	document.body.append(owner);
	const shadow = owner.attachShadow({ mode: "open" });
	const menu = document.createElement("div");
	menu.setAttribute("role", "dialog");
	menu.setAttribute("aria-modal", "true");
	const resume = document.createElement("button");
	const game = document.createElement("button");
	menu.append(resume);
	shadow.append(menu, game);
	await owner.requestFullscreen();
	resume.focus();
	if (focus === "body") resume.blur();
	if (focus === "game") game.focus();
	const back = vi.fn();
	document.addEventListener("fullscreenbackbutton", back);
	menu.addEventListener("keydown", (event) => {
		if (event.key !== "Escape") return;
		menu.hidden = true;
		event.preventDefault();
	});
	document.dispatchEvent(new Event("fullscreenbackbutton"));
	expect(menu.hidden).toBe(true);
	expect(back).not.toHaveBeenCalled();
	expect(document.fullscreenElement).toBe(owner);
	document.removeEventListener("fullscreenbackbutton", back);
});

test("Back retains callback delivery when a menu does not handle Escape or belongs to another owner", async () => {
	const owner = document.createElement("div");
	const menu = document.createElement("div");
	menu.setAttribute("role", "dialog");
	menu.setAttribute("aria-modal", "true");
	const button = document.createElement("button");
	menu.append(button);
	owner.append(menu);
	document.body.append(owner);
	await owner.requestFullscreen();
	button.focus();
	const back = vi.fn();
	document.addEventListener("fullscreenbackbutton", back);
	document.dispatchEvent(new Event("fullscreenbackbutton"));
	expect(back).toHaveBeenCalledOnce();
	expect(document.fullscreenElement).toBe(owner);
	const escape = vi.fn((event: Event) => event.preventDefault());
	menu.addEventListener("keydown", escape);
	menu.hidden = true;
	document.dispatchEvent(new Event("fullscreenbackbutton"));
	expect(back).toHaveBeenCalledTimes(2);
	expect(escape).not.toHaveBeenCalled();
	menu.hidden = false;
	document.body.append(menu);
	button.focus();
	document.dispatchEvent(new Event("fullscreenbackbutton"));
	expect(back).toHaveBeenCalledTimes(3);
	expect(escape).not.toHaveBeenCalled();
	document.removeEventListener("fullscreenbackbutton", back);
});

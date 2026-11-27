import fs from "node:fs";
import { Window } from "happy-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const source = fs.readFileSync(
	new URL("../../platforms/ios/runner/WebContextMenu.swift", import.meta.url),
	"utf8",
);
const script = source.match(/static let script = """\n([\s\S]*?)\n\s*"""/)[1];
let window, now;

beforeEach(() => {
	window = new Window();
	now = 0;
	vi.spyOn(window.performance, "now").mockImplementation(() => now);
	vi.spyOn(window.Date, "now").mockImplementation(() => now);
	window.eval(script);
});
afterEach(async () => {
	await window.happyDOM.close();
	vi.restoreAllMocks();
});

it.each([
	"button",
	"li",
	"a",
	"input",
	"plugin-control",
])("dispatches a bubbling, cancelable contextmenu on any %s element with touch coordinates", (type) => {
	const f = fixture(type);
	pointer(f.target, "pointerdown");
	now = 500;
	window.acodeNativeContextMenu();
	expect(f.menu).toHaveBeenCalledOnce();
	const event = f.menu.mock.calls[0][0];
	expect(event.target).toBe(f.target);
	expect(event).toMatchObject({
		button: 2,
		buttons: 2,
		clientX: 20,
		clientY: 30,
		bubbles: true,
		cancelable: true,
		composed: true,
	});
	window.acodeNativeContextMenu();
	expect(f.menu).toHaveBeenCalledOnce();
});

it("keeps programmatic activation working and blocks the trusted release click, including a menu overlay", () => {
	const f = fixture();
	f.target.addEventListener("contextmenu", () => f.target.click());
	pointer(f.target, "pointerdown");
	now = 500;
	window.acodeNativeContextMenu();
	expect(f.open).toHaveBeenCalledOnce();
	now = 2500;
	f.parent.dispatchEvent(new window.Event("scroll"));
	pointer(f.target, "pointerup");
	const overlay = window.document.createElement("button");
	f.parent.append(overlay);
	const selected = vi.fn();
	overlay.addEventListener("click", selected);
	expect(click(overlay).defaultPrevented).toBe(true);
	expect(selected).not.toHaveBeenCalled();
	pointer(overlay, "pointerdown");
	pointer(overlay, "pointerup");
	expect(click(overlay).defaultPrevented).toBe(false);
	expect(selected).toHaveBeenCalledOnce();
});

it.each([
	"release",
	"movement",
	"scroll",
	"cancel",
	"multitouch",
	"blur",
	"pagehide",
	"removed",
	"recycled",
	"pointer-prevented",
	"touch-prevented",
])("ignores a native notification after %s cancels the original touch", async (reason) => {
	const f = fixture();
	if (reason === "pointer-prevented")
		f.target.addEventListener("pointerdown", (event) => event.preventDefault());
	pointer(f.target, "pointerdown");
	if (reason === "release") pointer(f.target, "pointerup");
	if (reason === "movement") pointer(f.target, "pointermove", { clientX: 40 });
	if (reason === "scroll") f.parent.dispatchEvent(new window.Event("scroll"));
	if (reason === "cancel") pointer(f.target, "pointercancel");
	if (reason === "multitouch")
		pointer(f.parent, "pointerdown", { pointerId: 2, isPrimary: false });
	if (reason === "blur" || reason === "pagehide")
		window.dispatchEvent(new window.Event(reason));
	if (reason === "removed") f.target.remove();
	if (reason === "recycled") f.target.setAttribute("data-url", "file:///other");
	if (reason === "touch-prevented") {
		f.target.addEventListener("touchstart", (event) => event.preventDefault());
		f.target.dispatchEvent(
			new window.Event("touchstart", { bubbles: true, cancelable: true }),
		);
	}
	await Promise.resolve();
	now = 500;
	window.acodeNativeContextMenu();
	expect(f.menu).not.toHaveBeenCalled();
});

it("preserves the real target inside Shadow DOM and cancels a shadow-root scroll", () => {
	const f = fixture();
	const shadow = f.target.attachShadow({ mode: "open" });
	shadow.innerHTML = "<button>Shadow button</button>";
	const button = shadow.firstChild;
	pointer(button, "pointerdown");
	shadow.dispatchEvent(new window.Event("scroll"));
	now = 500;
	window.acodeNativeContextMenu();
	expect(f.menu).not.toHaveBeenCalled();
	pointer(button, "pointerdown");
	now = 1000;
	window.acodeNativeContextMenu();
	expect(f.menu).toHaveBeenCalledOnce();
	const inside = vi.fn();
	button.addEventListener("contextmenu", inside);
	pointer(button, "pointerdown");
	now = 1500;
	window.acodeNativeContextMenu();
	expect(inside.mock.calls[0][0].target).toBe(button);
});

it("allows short taps, keyboard activation, mouse right-clicks and expired release clicks", () => {
	const f = fixture();
	pointer(f.target, "pointerdown");
	pointer(f.target, "pointerup");
	now = 500;
	window.acodeNativeContextMenu();
	expect(f.menu).not.toHaveBeenCalled();
	expect(click(f.target).defaultPrevented).toBe(false);
	pointer(f.target, "pointerdown", { pointerType: "mouse" });
	const mouseMenu = new window.MouseEvent("contextmenu", {
		bubbles: true,
		cancelable: true,
	});
	Object.defineProperty(mouseMenu, "isTrusted", { value: true });
	f.target.dispatchEvent(mouseMenu);
	expect(f.menu).toHaveBeenCalledOnce();
	pointer(f.target, "pointerdown");
	now = 1000;
	window.acodeNativeContextMenu();
	pointer(f.target, "pointerup");
	expect(click(f.target, 0).defaultPrevented).toBe(false);
	pointer(f.target, "pointerdown");
	now = 1500;
	window.acodeNativeContextMenu();
	pointer(f.target, "pointerup");
	now = 2200;
	expect(click(f.target).defaultPrevented).toBe(false);
});

it("lets an existing trusted contextmenu win and avoids a duplicate native notification", () => {
	const f = fixture();
	pointer(f.target, "pointerdown");
	const event = new window.MouseEvent("contextmenu", {
		bubbles: true,
		cancelable: true,
	});
	Object.defineProperty(event, "isTrusted", { value: true });
	f.target.dispatchEvent(event);
	now = 500;
	window.acodeNativeContextMenu();
	expect(f.menu).toHaveBeenCalledOnce();
	pointer(f.target, "pointerup");
	expect(click(f.target).defaultPrevented).toBe(true);
});

function fixture(type = "div") {
	const parent = window.document.createElement("div");
	const target = window.document.createElement(type);
	parent.append(target);
	window.document.body.append(parent);
	const menu = vi.fn(),
		open = vi.fn();
	parent.addEventListener("contextmenu", menu);
	target.addEventListener("click", open);
	return { parent, target, menu, open };
}

function pointer(target, type, options = {}) {
	target.dispatchEvent(
		new window.PointerEvent(type, {
			bubbles: true,
			composed: true,
			cancelable: true,
			pointerType: "touch",
			isPrimary: true,
			pointerId: 1,
			clientX: 20,
			clientY: 30,
			...options,
		}),
	);
}

function click(target, detail = 1) {
	const event = new window.MouseEvent("click", {
		bubbles: true,
		composed: true,
		cancelable: true,
		detail,
	});
	Object.defineProperty(event, "isTrusted", { value: true });
	target.dispatchEvent(event);
	return event;
}

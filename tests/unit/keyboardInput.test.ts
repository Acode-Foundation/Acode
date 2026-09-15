// @vitest-environment happy-dom
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { focusEditorIfEditable } from "cm/editorReadOnly";
import { keyboardInput } from "cm/keyboardInput";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const show = vi.fn();
let view: EditorView;
let apiDescriptor: PropertyDescriptor | undefined;
let policyDescriptor: PropertyDescriptor | undefined;
beforeEach(() => {
	vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Chrome/145 Android");
	apiDescriptor = Object.getOwnPropertyDescriptor(navigator, "virtualKeyboard");
	policyDescriptor = Object.getOwnPropertyDescriptor(
		HTMLElement.prototype,
		"virtualKeyboardPolicy",
	);
	Object.defineProperty(navigator, "virtualKeyboard", {
		configurable: true,
		value: { show },
	});
	Object.defineProperty(HTMLElement.prototype, "virtualKeyboardPolicy", {
		configurable: true,
		value: "auto",
	});
	show.mockClear();
});
afterEach(() => {
	view?.destroy();
	document.body.replaceChildren();
	if (apiDescriptor)
		Object.defineProperty(navigator, "virtualKeyboard", apiDescriptor);
	else Reflect.deleteProperty(navigator, "virtualKeyboard");
	if (policyDescriptor)
		Object.defineProperty(
			HTMLElement.prototype,
			"virtualKeyboardPolicy",
			policyDescriptor,
		);
	else Reflect.deleteProperty(HTMLElement.prototype, "virtualKeyboardPolicy");
	vi.restoreAllMocks();
});
function create(readOnly = false) {
	view = new EditorView({
		parent: document.body,
		state: EditorState.create({
			doc: "one\ntwo",
			extensions: [keyboardInput, EditorState.readOnly.of(readOnly)],
		}),
	});
	return view;
}
function pointer(type: string, y = 100) {
	view.contentDOM.dispatchEvent(
		new PointerEvent(type, {
			pointerId: 1,
			pointerType: "touch",
			isPrimary: true,
			button: 0,
			clientX: 20,
			clientY: y,
			bubbles: true,
		}),
	);
}
function click() {
	view.contentDOM.dispatchEvent(
		new MouseEvent("click", { bubbles: true, detail: 1 }),
	);
}

describe("explicit Android keyboard control", () => {
	it("installs manual policy before finger-down and never requests the IME during a swipe", () => {
		create();
		expect(view.contentDOM.getAttribute("virtualkeyboardpolicy")).toBe(
			"manual",
		);
		view.focus();
		const focus = vi.spyOn(view, "focus");
		const blur = vi.spyOn(view.contentDOM, "blur");
		pointer("pointerdown");
		expect(show).not.toHaveBeenCalled();
		pointer("pointermove", 200);
		window.dispatchEvent(new Event("resize"));
		pointer("pointermove", 100); // Returning to the start cannot turn a drag into a tap.
		pointer("pointerup");
		click();
		view.dispatch({ selection: { anchor: 4 } });
		expect(show).not.toHaveBeenCalled();
		expect(focus).not.toHaveBeenCalled();
		expect(blur).not.toHaveBeenCalled();
		expect(view.hasFocus).toBe(true);
	});
	it("shows on a completed tap, including when DOM focus survived keyboard dismissal", () => {
		create();
		view.focus();
		for (let repeat = 0; repeat < 2; repeat++) {
			pointer("pointerdown");
			expect(show).toHaveBeenCalledTimes(repeat);
			pointer("pointerup");
			click();
			expect(show).toHaveBeenCalledTimes(repeat + 1);
		}
	});
	it("does not show after a cancelled touch or on a widget", () => {
		create();
		pointer("pointerdown");
		pointer("pointercancel");
		click();
		const button = view.contentDOM.appendChild(
			document.createElement("button"),
		);
		button.click();
		expect(show).not.toHaveBeenCalled();
	});
	it("allows explicit editor commands and accessibility activation", () => {
		create();
		focusEditorIfEditable(view);
		expect(show).toHaveBeenCalledTimes(1);
		view.contentDOM.click();
		expect(show).toHaveBeenCalledTimes(2);
	});
	it("never requests the keyboard for read-only content", () => {
		create(true);
		pointer("pointerdown");
		pointer("pointerup");
		click();
		focusEditorIfEditable(view);
		expect(show).not.toHaveBeenCalled();
	});
	it("keeps the browser default when the API is unavailable", () => {
		Reflect.deleteProperty(navigator, "virtualKeyboard");
		create();
		expect(view.contentDOM.hasAttribute("virtualkeyboardpolicy")).toBe(false);
	});
});

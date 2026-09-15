// @vitest-environment happy-dom

import { EditorState } from "@codemirror/state";
import { describe, expect, it, vi } from "vitest";
import browser from "../../vendor/codemirror-view/src/browser";
import { EditorView } from "../../vendor/codemirror-view/src/editorview";

describe("Android selection repair after scrolling", () => {
	it.each([
		true,
		false,
	])("does not cycle focus with controlled scrolling (waitForRendering=%s)", (waitForRendering) => {
		checkSelectionRepair(waitForRendering, false);
	});

	it("retains upstream keyboard recovery when controlled scrolling is not installed", () => {
		checkSelectionRepair(null, true);
	});
});

describe("Android delayed keyboard recovery", () => {
	it.each([
		true,
		false,
	])("respects dismissal after deletion when controlled scrolling is %s", (controlled) => {
		vi.useFakeTimers();
		const previous = { android: browser.android, chrome: browser.chrome };
		const viewportDescriptor = Object.getOwnPropertyDescriptor(
			window,
			"visualViewport",
		);
		const viewport = {
			height: 420,
			addEventListener() {},
			removeEventListener() {},
		};
		Object.defineProperty(window, "visualViewport", {
			configurable: true,
			value: viewport,
		});
		Object.assign(browser, { android: true, chrome: true });
		const parent = document.body.appendChild(document.createElement("div"));
		const view = new EditorView({
			parent,
			state: EditorState.create({
				doc: "text",
				extensions: controlled
					? [EditorView.controlledTouchScroll.of({ waitForRendering: false })]
					: [],
			}),
		});
		try {
			view.focus();
			const focus = vi.spyOn(view.contentDOM, "focus");
			const blur = vi.spyOn(view.contentDOM, "blur");
			const key = vi
				.spyOn(view.observer, "delayAndroidKey")
				.mockImplementation(() => {});
			view.contentDOM.dispatchEvent(
				new InputEvent("beforeinput", {
					inputType: "deleteContentBackward",
					bubbles: true,
				}),
			);
			expect(key).toHaveBeenCalledWith("Backspace", 8);
			viewport.height = 720; // Android Back dismisses the IME, keeping DOM focus.
			vi.advanceTimersByTime(150);
			expect(focus).toHaveBeenCalledTimes(controlled ? 0 : 1);
			expect(blur).toHaveBeenCalledTimes(controlled ? 0 : 1);
		} finally {
			view.destroy();
			parent.remove();
			Object.assign(browser, previous);
			if (viewportDescriptor)
				Object.defineProperty(window, "visualViewport", viewportDescriptor);
			else Reflect.deleteProperty(window, "visualViewport");
			vi.restoreAllMocks();
			vi.useRealTimers();
		}
	});
});

function checkSelectionRepair(
	waitForRendering: boolean | null,
	expectsFocusCycle: boolean,
) {
	const previous = { android: browser.android, chrome: browser.chrome };
	Object.assign(browser, { android: true, chrome: true });
	const parent = document.body.appendChild(document.createElement("div"));
	const view = new EditorView({
		parent,
		state: EditorState.create({
			doc: "one\ntwo\nthree",
			extensions:
				waitForRendering === null
					? []
					: EditorView.controlledTouchScroll.of({ waitForRendering }),
		}),
	});
	try {
		view.focus(); // Android Back can dismiss the keyboard without losing DOM focus.
		const focus = vi.spyOn(view.contentDOM, "focus");
		const blur = vi.spyOn(view.contentDOM, "blur");
		const gap = document.createElement("div");
		gap.contentEditable = "false";
		gap.appendChild(document.createTextNode("virtualized gap"));
		view.observer.ignore(() => view.contentDOM.appendChild(gap));
		for (let redraw = 0; redraw < 3; redraw++) {
			view.observer.ignore(() =>
				document.getSelection()!.collapse(gap.firstChild, 0),
			);
			view.docView.forceSelection = true;
			view.docView.updateSelection(true);
		}
		expect(focus).toHaveBeenCalledTimes(expectsFocusCycle ? 3 : 0);
		expect(blur).toHaveBeenCalledTimes(expectsFocusCycle ? 3 : 0);
		expect(document.activeElement).toBe(view.contentDOM);
		focus.mockClear();
		view.focus(); // Explicit user-driven focus remains available.
		expect(focus).toHaveBeenCalledTimes(1);
	} finally {
		view.destroy();
		parent.remove();
		Object.assign(browser, previous);
		vi.restoreAllMocks();
	}
}

// @vitest-environment happy-dom

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
	keyboardScroll,
	markKeyboardScrollBrowsing,
	registerKeyboardCursorReveal,
} from "cm/keyboardScroll";
import { afterEach, describe, expect, it, vi } from "vitest";

const views: EditorView[] = [];
afterEach(() => {
	for (const view of views.splice(0)) view.destroy();
});

function createView() {
	const view = new EditorView({
		state: EditorState.create({
			doc: "one\ntwo\nthree",
			extensions: [keyboardScroll],
		}),
	});
	views.push(view);
	return view;
}

function touch(type: string, y: number) {
	const event = new Event(type, { bubbles: true });
	Object.defineProperty(event, "touches", {
		value: [{ clientX: 100, clientY: y }],
	});
	return event;
}

function keyboardHarness(view: EditorView) {
	const callbacks = new Map<string, () => void>();
	const measurements: {
		read: () => number | null;
		write: (top: number | null) => void;
	}[] = [];
	Object.defineProperty(view, "hasFocus", { configurable: true, value: true });
	Object.defineProperty(view.scrollDOM, "clientHeight", {
		configurable: true,
		value: 300,
	});
	vi.spyOn(view.scrollDOM, "getBoundingClientRect").mockReturnValue({
		top: 0,
	} as DOMRect);
	let initialTop: number | null = null;
	const coords = vi.spyOn(view, "coordsAtPos").mockImplementation(() => {
		initialTop ??= view.scrollDOM.scrollTop;
		const delta = view.scrollDOM.scrollTop - initialTop;
		return { top: 350 - delta, bottom: 370 - delta, left: 0, right: 1 };
	});
	vi.spyOn(view, "requestMeasure").mockImplementation((request: any) => {
		if (request) measurements.push(request);
	});
	let activeView: EditorView | null = view;
	const cleanup = registerKeyboardCursorReveal({
		events: {
			on: (name, callback) => {
				callbacks.set(name, callback);
			},
			off: (name) => {
				callbacks.delete(name);
			},
		},
		getView: () => activeView,
		canReveal: () => true,
	});
	return {
		coords,
		cleanup,
		show: () => {
			callbacks.get("keyboardShowStart")?.();
			callbacks.get("keyboardShow")?.();
		},
		hide: () => callbacks.get("keyboardHide")?.(),
		changeView: (next: EditorView) => {
			activeView = next;
		},
		measure: () => {
			for (const request of measurements.splice(0)) {
				const top = request.read();
				// Writes must never call coordsAtPos (CodeMirror disallows layout reads there).
				const reads = coords.mock.calls.length;
				request.write(top);
				expect(coords.mock.calls.length).toBe(reads);
			}
		},
	};
}

describe("keyboard scroll intent", () => {
	it("preserves a browsed viewport through repeated keyboard open and close", () => {
		const view = createView();
		const keyboard = keyboardHarness(view);
		view.scrollDOM.dispatchEvent(touch("touchstart", 500));
		view.scrollDOM.dispatchEvent(touch("touchmove", 300));
		view.scrollDOM.dispatchEvent(touch("touchend", 300));
		view.scrollDOM.scrollTop = 900;
		for (let i = 0; i < 3; i++) {
			keyboard.show();
			keyboard.hide();
			keyboard.measure();
		}
		expect(view.scrollDOM.scrollTop).toBe(900);
		expect(keyboard.coords).not.toHaveBeenCalled();
		keyboard.cleanup();
	});

	it("does not classify a tap as scrolling", () => {
		const view = createView();
		view.scrollDOM.dispatchEvent(touch("touchstart", 500));
		view.scrollDOM.dispatchEvent(touch("touchmove", 499));
		view.scrollDOM.dispatchEvent(touch("touchend", 499));
		expect(view.plugin(keyboardScroll)?.browsing).toBe(false);
	});

	it("follows an explicit caret selection again and reveals only the obscured amount", () => {
		const view = createView();
		const keyboard = keyboardHarness(view);
		markKeyboardScrollBrowsing(view);
		view.dispatch({ selection: { anchor: 5 } });
		view.scrollDOM.scrollTop = 500;
		keyboard.show();
		keyboard.measure();
		expect(view.scrollDOM.scrollTop).toBe(594);
		keyboard.hide();
		const top = view.scrollDOM.scrollTop;
		keyboard.measure();
		expect(view.scrollDOM.scrollTop).toBe(top);
		keyboard.cleanup();
	});

	it("cancels a queued keyboard reveal when the user starts scrolling", () => {
		const view = createView();
		const keyboard = keyboardHarness(view);
		view.scrollDOM.scrollTop = 900;
		keyboard.show();
		view.scrollDOM.dispatchEvent(new WheelEvent("wheel", { deltaY: 120 }));
		keyboard.measure();
		expect(view.scrollDOM.scrollTop).toBe(900);
		keyboard.cleanup();
	});

	it("cancels a queued opening reveal if the keyboard closes before measurement", () => {
		const view = createView();
		const keyboard = keyboardHarness(view);
		view.scrollDOM.scrollTop = 900;
		keyboard.show();
		keyboard.hide();
		keyboard.measure();
		expect(view.scrollDOM.scrollTop).toBe(900);
		keyboard.cleanup();
	});

	it("does not move a different pane or execute a disposed callback", () => {
		const first = createView(),
			second = createView();
		const keyboard = keyboardHarness(first);
		first.scrollDOM.scrollTop = 500;
		keyboard.show();
		keyboard.changeView(second);
		keyboard.measure();
		expect(first.scrollDOM.scrollTop).toBe(500);
		expect(second.scrollDOM.scrollTop).toBe(0);
		keyboard.changeView(first);
		keyboard.show();
		keyboard.cleanup();
		keyboard.measure();
		expect(first.scrollDOM.scrollTop).toBe(500);
	});

	it("clears browsing on typing while keeping other panes independent", () => {
		const first = createView(),
			second = createView();
		markKeyboardScrollBrowsing(first);
		markKeyboardScrollBrowsing(second);
		first.dispatch({ changes: { from: 0, insert: "x" } });
		expect(first.plugin(keyboardScroll)?.browsing).toBe(false);
		expect(second.plugin(keyboardScroll)?.browsing).toBe(true);
	});
});

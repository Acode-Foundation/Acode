// @vitest-environment happy-dom

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import pinchZoom, {
	clampEditorFontSize,
	computePinchFontSize,
} from "cm/pinchZoom";

const { settingsMock } = vi.hoisted(() => ({
	settingsMock: {
		value: { fontSize: "12px" },
		update: vi.fn(),
	},
}));

vi.mock("lib/settings", () => ({ default: settingsMock }));

let now = 1_000_000;

/**
 * @param fontSize px size applied to the content element so that the computed
 * style (which drives the pinch ratio) is deterministic in happy-dom.
 */
function createView(fontSize = "12px") {
	const parent = document.createElement("div");
	document.body.append(parent);
	settingsMock.value.fontSize = fontSize;
	const view = new EditorView({
		state: EditorState.create({
			doc: "hello world",
			extensions: [pinchZoom()],
		}),
		parent,
	});
	view.contentDOM.style.fontSize = fontSize;
	return view;
}

function fireTouch(
	view: EditorView,
	type: string,
	points: Array<{ clientX: number; clientY: number }>,
) {
	const event = new Event(type, { cancelable: true });
	Object.defineProperty(event, "touches", { value: points });
	view.dom.dispatchEvent(event);
}

beforeEach(() => {
	now = 1_000_000;
	vi.spyOn(Date, "now").mockImplementation(() => now);
	settingsMock.value.fontSize = "12px";
	settingsMock.update.mockClear();
});

afterEach(() => {
	vi.restoreAllMocks();
	document.body.innerHTML = "";
});

describe("pinchZoom helpers", () => {
	it("scales font size with the pinch ratio", () => {
		expect(computePinchFontSize(12, 100, 200)).toBe(24);
		expect(computePinchFontSize(24, 100, 50)).toBe(12);
	});

	it("clamps to the same 6-72px range as the font size commands", () => {
		expect(computePinchFontSize(12, 100, 10)).toBe(6);
		expect(computePinchFontSize(60, 100, 500)).toBe(72);
		expect(clampEditorFontSize(77.4)).toBe(72);
	});

	it("falls back to 12px on invalid input", () => {
		expect(computePinchFontSize(Number.NaN, 100, 200)).toBe(24);
		expect(computePinchFontSize(12, 0, 200)).toBe(12);
	});
});

describe("pinchZoom gesture", () => {
	it("spreading two fingers previews on the editor and persists once", () => {
		const view = createView();

		fireTouch(view, "touchstart", [
			{ clientX: 0, clientY: 0 },
			{ clientX: 100, clientY: 0 },
		]);
		now += 60;
		fireTouch(view, "touchmove", [
			{ clientX: 0, clientY: 0 },
			{ clientX: 200, clientY: 0 },
		]);

		// Live preview is applied directly to the editor.
		expect(view.contentDOM.style.fontSize).toBe("24px");
		// Nothing is written to settings while the fingers are down.
		expect(settingsMock.update).not.toHaveBeenCalled();

		fireTouch(view, "touchend", [{ clientX: 0, clientY: 0 }]);

		// One persist at gesture end: update(false).
		expect(settingsMock.update).toHaveBeenCalledTimes(1);
		expect(settingsMock.update).toHaveBeenCalledWith(false);
		expect(settingsMock.value.fontSize).toBe("24px");
		// The inline preview is dropped so the rebuilt font theme takes over.
		expect(view.contentDOM.style.fontSize).toBe("12px");
		view.destroy();
	});

	it("uses the displayed font size, not the raw setting, as the ratio base", () => {
		// settings.json stores 1rem; the editor displays 16px.
		const view = createView("16px");
		settingsMock.value.fontSize = "1rem";

		fireTouch(view, "touchstart", [
			{ clientX: 0, clientY: 0 },
			{ clientX: 100, clientY: 0 },
		]);
		now += 60;
		fireTouch(view, "touchmove", [
			{ clientX: 0, clientY: 0 },
			{ clientX: 200, clientY: 0 },
		]);

		// 16px * 200/100 = 32px (parsing "1rem" as 1 would clamp down to 6px).
		expect(view.contentDOM.style.fontSize).toBe("32px");
		view.destroy();
	});

	it("pinching in clamps at 6px", () => {
		const view = createView();

		fireTouch(view, "touchstart", [
			{ clientX: 0, clientY: 0 },
			{ clientX: 400, clientY: 0 },
		]);
		now += 60;
		fireTouch(view, "touchmove", [
			{ clientX: 0, clientY: 0 },
			{ clientX: 50, clientY: 0 },
		]);

		expect(view.contentDOM.style.fontSize).toBe("6px");

		fireTouch(view, "touchend", [{ clientX: 0, clientY: 0 }]);
		expect(settingsMock.value.fontSize).toBe("6px");
		view.destroy();
	});

	it("throttles rapid touchmove events and applies the final size", () => {
		const view = createView();

		fireTouch(view, "touchstart", [
			{ clientX: 0, clientY: 0 },
			{ clientX: 100, clientY: 0 },
		]);

		now += 60;
		fireTouch(view, "touchmove", [
			{ clientX: 0, clientY: 0 },
			{ clientX: 150, clientY: 0 },
		]);

		expect(view.contentDOM.style.fontSize).toBe("18px");

		fireTouch(view, "touchmove", [
			{ clientX: 0, clientY: 0 },
			{ clientX: 300, clientY: 0 },
		]);

		// The second move is throttled during the gesture.
		expect(view.contentDOM.style.fontSize).toBe("18px");

		// Ending the gesture must apply the latest pending distance.
		fireTouch(view, "touchend", [{ clientX: 0, clientY: 0 }]);

		expect(settingsMock.value.fontSize).toBe("36px");
		expect(settingsMock.update).toHaveBeenCalledWith(false);

		view.destroy();
	});

	it("ignores single-finger touches", () => {
		const view = createView();

		fireTouch(view, "touchstart", [{ clientX: 0, clientY: 0 }]);
		now += 60;
		fireTouch(view, "touchmove", [{ clientX: 0, clientY: 400 }]);

		expect(view.contentDOM.style.fontSize).toBe("12px");
		expect(settingsMock.update).not.toHaveBeenCalled();
		view.destroy();
	});

	it("returning to the starting size saves nothing and shows the start size", () => {
		const view = createView();

		fireTouch(view, "touchstart", [
			{ clientX: 0, clientY: 0 },
			{ clientX: 100, clientY: 0 },
		]);
		now += 60;
		fireTouch(view, "touchmove", [
			{ clientX: 0, clientY: 0 },
			{ clientX: 200, clientY: 0 },
		]);
		expect(view.contentDOM.style.fontSize).toBe("24px");

		now += 60;
		fireTouch(view, "touchmove", [
			{ clientX: 0, clientY: 0 },
			{ clientX: 100, clientY: 0 },
		]);
		expect(view.contentDOM.style.fontSize).toBe("12px");

		fireTouch(view, "touchend", [{ clientX: 0, clientY: 0 }]);

		// The saved value never changed, so settings are never touched and the
		// font theme (still 12px) matches what the editor shows.
		expect(settingsMock.update).not.toHaveBeenCalled();
		expect(settingsMock.value.fontSize).toBe("12px");
		expect(view.contentDOM.style.fontSize).toBe("12px");
		view.destroy();
	});

	it("does not change a fractional size on a two-finger tap", () => {
		const view = createView("9.5px");

		fireTouch(view, "touchstart", [
			{ clientX: 0, clientY: 0 },
			{ clientX: 100, clientY: 0 },
		]);
		fireTouch(view, "touchend", [{ clientX: 0, clientY: 0 }]);

		expect(settingsMock.update).not.toHaveBeenCalled();
		expect(settingsMock.value.fontSize).toBe("9.5px");
		expect(view.contentDOM.style.fontSize).toBe("9.5px");
		view.destroy();
	});

	it("does not clamp an out-of-range size on a two-finger tap", () => {
		const view = createView("99px");

		fireTouch(view, "touchstart", [
			{ clientX: 0, clientY: 0 },
			{ clientX: 100, clientY: 0 },
		]);
		fireTouch(view, "touchend", [{ clientX: 0, clientY: 0 }]);

		expect(settingsMock.update).not.toHaveBeenCalled();
		expect(settingsMock.value.fontSize).toBe("99px");
		expect(view.contentDOM.style.fontSize).toBe("99px");
		view.destroy();
	});
});
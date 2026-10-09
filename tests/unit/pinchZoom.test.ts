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

function createView() {
	const parent = document.createElement("div");
	document.body.append(parent);
	return new EditorView({
		state: EditorState.create({
			doc: "hello world",
			extensions: [pinchZoom()],
		}),
		parent,
	});
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
	it("spreading two fingers increases fontSize and persists once", () => {
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

		expect(settingsMock.value.fontSize).toBe("24px");
		// Live update, no save: update(undefined, false, false)
		expect(settingsMock.update).toHaveBeenCalledWith(undefined, false, false);

		fireTouch(view, "touchend", [{ clientX: 0, clientY: 0 }]);
		// One persist at gesture end: update(false)
		expect(settingsMock.update).toHaveBeenCalledWith(false);
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

		expect(settingsMock.value.fontSize).toBe("6px");
		view.destroy();
	});

	it("throttles rapid touchmove events", () => {
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
		fireTouch(view, "touchmove", [
			{ clientX: 0, clientY: 0 },
			{ clientX: 300, clientY: 0 },
		]);

		// Second move is inside the 50ms window -> size from first move only
		expect(settingsMock.value.fontSize).toBe("18px");
		view.destroy();
	});

	it("ignores single-finger touches", () => {
		const view = createView();

		fireTouch(view, "touchstart", [{ clientX: 0, clientY: 0 }]);
		now += 60;
		fireTouch(view, "touchmove", [{ clientX: 0, clientY: 400 }]);

		expect(settingsMock.value.fontSize).toBe("12px");
		expect(settingsMock.update).not.toHaveBeenCalled();
		view.destroy();
	});

	it("does not persist when the gesture ends at the starting size", () => {
		const view = createView();

		fireTouch(view, "touchstart", [
			{ clientX: 0, clientY: 0 },
			{ clientX: 100, clientY: 0 },
		]);
		fireTouch(view, "touchend", [{ clientX: 0, clientY: 0 }]);

		expect(settingsMock.update).not.toHaveBeenCalled();
		view.destroy();
	});
});
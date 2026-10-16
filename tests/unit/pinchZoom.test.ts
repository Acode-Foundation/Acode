
 // @vitest-environment happy-dom

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import pinchZoom, {
    computePinchFontSize,
} from "../../src/cm/pinchZoom";
import { clampEditorFontSize } from "../../src/cm/editorFontSize";

const { settingsMock } = vi.hoisted(() => ({
    settingsMock: {
        value: { fontSize: "12px" },
        update: vi.fn(),
    },
}));

vi.mock("lib/settings", () => ({ default: settingsMock }));

let now = 1_000_000;

function createView(fontSize = "12px") {
    const parent = document.createElement("div");
    document.body.append(parent);
    settingsMock.value.fontSize = fontSize;

    const view = new EditorView({
        state: EditorState.create({
            doc: "hello world",
            extensions: [pinchZoom],
        }),
        parent,
    });

    view.dom.style.fontSize = fontSize;
    return view;
}

function fireTouch(
    view: EditorView,
    type: string,
    points: Array<{
        clientX: number;
        clientY: number;
        identifier?: number;
    }>,
    target: EventTarget = view.contentDOM
) {
    const touches = points.map((point, index) => ({
        ...point,
        identifier: point.identifier ?? index + 1,
        target: view.contentDOM,
    }));

    const event = new Event(type, {
        cancelable: true,
        bubbles: true,
    });

    for (const property of ["touches", "changedTouches", "targetTouches"]) {
        Object.defineProperty(event, property, {
            value: Object.assign([...touches], {
                item(index: number) {
                    return touches[index] ?? null;
                },
            }),
        });
    }

    view.contentDOM.dispatchEvent(event);
}
let frameQueue: Array<() => void> = [];
beforeEach(() => {
    frameQueue = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
        frameQueue.push(() => cb(0));
        return frameQueue.length;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    settingsMock.value.fontSize = "12px";
    settingsMock.update.mockClear();
});
function flushFrames() {
    const queue = frameQueue;
    frameQueue = [];
    queue.forEach((run) => run());
}

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
    it("confirms a held pinch that ends without another touchmove", () => {
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

        // Held still past the confirmation delay: no further touchmove.
        now += 121;

        fireTouch(view, "touchend", [{ clientX: 0, clientY: 0 }]);

        expect(settingsMock.value.fontSize).toBe("24px");
        expect(settingsMock.update).toHaveBeenCalledTimes(1);
        expect(settingsMock.update).toHaveBeenCalledWith(false);
        expect(view.dom.style.fontSize).toBe("12px");

        view.destroy();
    });

    it("still ignores a brief spread released inside the confirmation delay", () => {
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

        // Released only 50ms after the candidate movement was recorded.
        now += 50;
        fireTouch(view, "touchend", [{ clientX: 0, clientY: 0 }]);

        expect(settingsMock.update).not.toHaveBeenCalled();
        expect(settingsMock.value.fontSize).toBe("12px");

        view.destroy();
    });
    it("applies the movement dropped by the throttle on the next frame", () => {
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

        now += 121;
        fireTouch(view, "touchmove", [
            { clientX: 0, clientY: 0 },
            { clientX: 150, clientY: 0 },
        ]);

        expect(view.dom.style.fontSize).toBe("18px");

        // Inside the throttle window: not applied synchronously, queued instead.
        now += 10;
        fireTouch(view, "touchmove", [
            { clientX: 0, clientY: 0 },
            { clientX: 300, clientY: 0 },
        ]);

        expect(view.dom.style.fontSize).toBe("18px");

        flushFrames();

        expect(view.dom.style.fontSize).toBe("36px");

        fireTouch(view, "touchend", [{ clientX: 0, clientY: 0 }]);

        expect(settingsMock.value.fontSize).toBe("36px");
        expect(settingsMock.update).toHaveBeenCalledTimes(1);

        view.destroy();
    });

    it("does not apply a scheduled frame after the view is destroyed", () => {
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

        now += 121;
        fireTouch(view, "touchmove", [
            { clientX: 0, clientY: 0 },
            { clientX: 150, clientY: 0 },
        ]);

        now += 10;
        fireTouch(view, "touchmove", [
            { clientX: 0, clientY: 0 },
            { clientX: 300, clientY: 0 },
        ]);

        view.destroy();
        flushFrames();

        expect(settingsMock.update).not.toHaveBeenCalled();
        expect(settingsMock.value.fontSize).toBe("12px");
    });
    it("keeps the original pair when a third finger lands and ends when one lifts", () => {
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

        now += 121;
        fireTouch(view, "touchmove", [
            { clientX: 0, clientY: 0 },
            { clientX: 200, clientY: 0 },
        ]);

        expect(view.dom.style.fontSize).toBe("24px");

        // Third finger lands: ignored while pinching.
        fireTouch(view, "touchstart", [
            { clientX: 0, clientY: 0, identifier: 1 },
            { clientX: 200, clientY: 0, identifier: 2 },
            { clientX: 60, clientY: 60, identifier: 3 },
        ]);

        now += 60;
        // Reordered touch list (B, C, A) must still measure A-B = 200, not B-C.
        fireTouch(view, "touchmove", [
            { clientX: 200, clientY: 0, identifier: 2 },
            { clientX: 60, clientY: 60, identifier: 3 },
            { clientX: 0, clientY: 0, identifier: 1 },
        ]);

        expect(view.dom.style.fontSize).toBe("24px");
        expect(settingsMock.update).not.toHaveBeenCalled();

        // Original finger A lifts: remaining touches are B and C.
        fireTouch(view, "touchend", [
            { clientX: 200, clientY: 0, identifier: 2 },
            { clientX: 60, clientY: 60, identifier: 3 },
        ]);

        expect(settingsMock.update).toHaveBeenCalledTimes(1);
        expect(settingsMock.update).toHaveBeenCalledWith(false);
        expect(settingsMock.value.fontSize).toBe("24px");
        expect(view.dom.style.fontSize).toBe("12px");

        view.destroy();
    });
    it("ignores sub-pixel finger jitter and does not save or clamp", () => {
        const view = createView("9.5px");

        fireTouch(view, "touchstart", [
            { clientX: 0, clientY: 0 },
            { clientX: 100, clientY: 0 },
        ]);

        now += 60;
        fireTouch(view, "touchmove", [
            { clientX: 0, clientY: 0.4 },
            { clientX: 100.4, clientY: 0 },
        ]);

        now += 121;
        fireTouch(view, "touchmove", [
            { clientX: 0, clientY: 0.4 },
            { clientX: 100.4, clientY: 0 },
        ]);

        expect(view.dom.style.fontSize).toBe("9.5px");

        fireTouch(view, "touchend", [{ clientX: 0, clientY: 0 }]);

        expect(settingsMock.update).not.toHaveBeenCalled();
        expect(settingsMock.value.fontSize).toBe("9.5px");
        expect(view.dom.style.fontSize).toBe("9.5px");

        view.destroy();
    });

    it("ignores movement below the 15px move threshold even after the confirmation delay", () => {
        const view = createView("99px");

        fireTouch(view, "touchstart", [
            { clientX: 0, clientY: 0 },
            { clientX: 100, clientY: 0 },
        ]);

        now += 60;
        fireTouch(view, "touchmove", [
            { clientX: 0, clientY: 0 },
            { clientX: 110, clientY: 0 },
        ]);

        now += 121;
        fireTouch(view, "touchmove", [
            { clientX: 0, clientY: 0 },
            { clientX: 110, clientY: 0 },
        ]);

        expect(view.dom.style.fontSize).toBe("99px");

        fireTouch(view, "touchend", [{ clientX: 0, clientY: 0 }]);

        expect(settingsMock.update).not.toHaveBeenCalled();
        expect(settingsMock.value.fontSize).toBe("99px");

        view.destroy();
    });
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

        expect(view.dom.style.fontSize).toBe("12px");

        now += 121;
        fireTouch(view, "touchmove", [
            { clientX: 0, clientY: 0 },
            { clientX: 200, clientY: 0 },
        ]);

        expect(view.dom.style.fontSize).toBe("24px");
        expect(settingsMock.update).not.toHaveBeenCalled();

        fireTouch(view, "touchend", [{ clientX: 0, clientY: 0 }]);

        expect(settingsMock.update).toHaveBeenCalledTimes(1);
        expect(settingsMock.update).toHaveBeenCalledWith(false);
        expect(settingsMock.value.fontSize).toBe("24px");
        expect(view.dom.style.fontSize).toBe("12px");

        view.destroy();
    });

    it("uses the displayed font size, not the raw setting, as the ratio base", () => {
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

        expect(view.dom.style.fontSize).toBe("16px");

        now += 121;
        fireTouch(view, "touchmove", [
            { clientX: 0, clientY: 0 },
            { clientX: 200, clientY: 0 },
        ]);

        expect(view.dom.style.fontSize).toBe("32px");
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
            { clientX: 200, clientY: 0 },
        ]);

        expect(view.dom.style.fontSize).toBe("12px");

        now += 121;
        fireTouch(view, "touchmove", [
            { clientX: 0, clientY: 0 },
            { clientX: 200, clientY: 0 },
        ]);

        expect(view.dom.style.fontSize).toBe("6px");

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

        // First move starts the confirmation window.
        now += 60;
        fireTouch(view, "touchmove", [
            { clientX: 0, clientY: 0 },
            { clientX: 150, clientY: 0 },
        ]);

        expect(view.dom.style.fontSize).toBe("12px");

        // Confirm after the required delay.
        now += 121;
        fireTouch(view, "touchmove", [
            { clientX: 0, clientY: 0 },
            { clientX: 150, clientY: 0 },
        ]);

        expect(view.dom.style.fontSize).toBe("18px");

        // This movement occurs inside the throttle window.
        now += 10;
        fireTouch(view, "touchmove", [
            { clientX: 0, clientY: 0 },
            { clientX: 300, clientY: 0 },
        ]);

        expect(view.dom.style.fontSize).toBe("18px");

        // Ending the gesture applies the latest pending distance.
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

        expect(view.dom.style.fontSize).toBe("12px");
        expect(settingsMock.update).not.toHaveBeenCalled();

        view.destroy();
    });

    it("does not zoom after a brief movement before confirmation", () => {
        const view = createView();

        fireTouch(view, "touchstart", [
            { clientX: 0, clientY: 0 },
            { clientX: 100, clientY: 0 },
        ]);

        now += 60;
        fireTouch(view, "touchmove", [
            { clientX: 0, clientY: 0 },
            { clientX: 120, clientY: 0 },
        ]);

        expect(view.dom.style.fontSize).toBe("12px");

        // Release before the confirmation window completes.
        fireTouch(view, "touchend", [{ clientX: 0, clientY: 0 }]);

        expect(settingsMock.update).not.toHaveBeenCalled();
        expect(settingsMock.value.fontSize).toBe("12px");

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

        now += 121;
        fireTouch(view, "touchmove", [
            { clientX: 0, clientY: 0 },
            { clientX: 200, clientY: 0 },
        ]);

        expect(view.dom.style.fontSize).toBe("24px");

        now += 60;
        fireTouch(view, "touchmove", [
            { clientX: 0, clientY: 0 },
            { clientX: 100, clientY: 0 },
        ]);

        expect(view.dom.style.fontSize).toBe("12px");

        fireTouch(view, "touchend", [{ clientX: 0, clientY: 0 }]);

        expect(settingsMock.update).not.toHaveBeenCalled();
        expect(settingsMock.value.fontSize).toBe("12px");
        expect(view.dom.style.fontSize).toBe("12px");

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
        expect(view.dom.style.fontSize).toBe("9.5px");

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
        expect(view.dom.style.fontSize).toBe("99px");

        view.destroy();
    });

    it("completes a pinch whose move and end reach the document only", () => {
        const view = createView();

        fireTouch(view, "touchstart", [
            { clientX: 0, clientY: 0 },
            { clientX: 100, clientY: 0 },
        ]);

        now += 60;
        fireTouch(view, "touchmove", [
            { clientX: 0, clientY: 0 },
            { clientX: 200, clientY: 0 },
        ], document);

        now += 121;
        fireTouch(view, "touchmove", [
            { clientX: 0, clientY: 0 },
            { clientX: 200, clientY: 0 },
        ], document);

        expect(view.dom.style.fontSize).toBe("24px");

        fireTouch(view, "touchend", [{ clientX: 0, clientY: 0 }], document);

        expect(settingsMock.value.fontSize).toBe("24px");
        expect(settingsMock.update).toHaveBeenCalledTimes(1);

        view.destroy();
    });

    it("recovers when the gesture events are lost to an unmounted line", () => {
        const view = createView();
        const detached = document.createElement("div");

        fireTouch(view, "touchstart", [
            { clientX: 0, clientY: 0 },
            { clientX: 100, clientY: 0 },
        ]);

        now += 60;
        fireTouch(view, "touchmove", [
            { clientX: 0, clientY: 0 },
            { clientX: 200, clientY: 0 },
        ], detached);
        fireTouch(view, "touchend", [{ clientX: 0, clientY: 0 }], detached);

        // Events went nowhere; the stuck gesture must not save anything.
        expect(settingsMock.update).not.toHaveBeenCalled();

        // A fresh two-finger touchstart revives the pinch.
        fireTouch(view, "touchstart", [
            { clientX: 0, clientY: 0 },
            { clientX: 100, clientY: 0 },
        ]);
        now += 60;
        fireTouch(view, "touchmove", [
            { clientX: 0, clientY: 0 },
            { clientX: 200, clientY: 0 },
        ]);
        now += 121;
        fireTouch(view, "touchmove", [
            { clientX: 0, clientY: 0 },
            { clientX: 200, clientY: 0 },
        ]);
        fireTouch(view, "touchend", [{ clientX: 0, clientY: 0 }]);

        expect(settingsMock.value.fontSize).toBe("24px");
        expect(settingsMock.update).toHaveBeenCalledTimes(1);

        view.destroy();
    });
});

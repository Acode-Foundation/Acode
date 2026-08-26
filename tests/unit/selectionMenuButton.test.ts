// @vitest-environment happy-dom

import { bindSelectionMenuButton } from "cm/selectionMenuUtils";
import { describe, expect, it, vi } from "vitest";

function pointerEvent(
	type: string,
	pointerId = 7,
	position: { x: number; y: number } = { x: 0, y: 0 },
) {
	return new PointerEvent(type, {
		bubbles: true,
		button: 0,
		cancelable: true,
		clientX: position.x,
		clientY: position.y,
		isPrimary: true,
		pointerId,
		pointerType: "touch",
	});
}

describe("selection menu button interaction", () => {
	it("preserves pointer-down and activates exactly once on release", () => {
		const button = document.createElement("button");
		const activate = vi.fn();
		bindSelectionMenuButton(button, activate);

		const down = pointerEvent("pointerdown");
		button.dispatchEvent(down);
		expect(down.defaultPrevented).toBe(true);
		expect(button.classList.contains("is-pressed")).toBe(true);
		expect(activate).not.toHaveBeenCalled();

		button.dispatchEvent(pointerEvent("pointerup"));
		button.dispatchEvent(
			new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }),
		);

		expect(button.classList.contains("is-pressed")).toBe(false);
		expect(activate).toHaveBeenCalledTimes(1);
	});

	it("supports keyboard clicks and cancels interrupted presses", () => {
		const button = document.createElement("button");
		const activate = vi.fn();
		bindSelectionMenuButton(button, activate);

		button.dispatchEvent(pointerEvent("pointerdown"));
		button.dispatchEvent(pointerEvent("pointercancel"));
		expect(activate).not.toHaveBeenCalled();

		button.dispatchEvent(
			new MouseEvent("click", { bubbles: true, cancelable: true, detail: 0 }),
		);
		expect(activate).toHaveBeenCalledTimes(1);
	});

	it("does not activate an action when the pointer becomes a scroll gesture", () => {
		const button = document.createElement("button");
		const activate = vi.fn();
		bindSelectionMenuButton(button, activate);

		button.dispatchEvent(pointerEvent("pointerdown", 7, { x: 10, y: 10 }));
		button.dispatchEvent(pointerEvent("pointermove", 7, { x: 10, y: 30 }));
		button.dispatchEvent(pointerEvent("pointerup", 7, { x: 10, y: 30 }));
		button.dispatchEvent(
			new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }),
		);

		expect(button.classList.contains("is-pressed")).toBe(false);
		expect(activate).not.toHaveBeenCalled();
	});

	it("checks final pointer displacement when no move event is delivered", () => {
		const button = document.createElement("button");
		const activate = vi.fn();
		bindSelectionMenuButton(button, activate);

		button.dispatchEvent(pointerEvent("pointerdown", 7, { x: 10, y: 10 }));
		button.dispatchEvent(pointerEvent("pointerup", 7, { x: 30, y: 10 }));
		button.dispatchEvent(
			new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }),
		);

		expect(button.classList.contains("is-pressed")).toBe(false);
		expect(activate).not.toHaveBeenCalled();
	});
});

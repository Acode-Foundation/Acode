import { describe, expect, it, vi } from "vitest";
import { handleTerminalKeyAction } from "components/terminal/terminalKeyEvent";

describe("terminal key actions", () => {
	it("runs a shortcut side effect once across keydown and keyup", () => {
		const action = vi.fn();
		const preventDefault = vi.fn();

		expect(
			handleTerminalKeyAction({ type: "keydown", preventDefault }, action),
		).toBe(false);
		expect(
			handleTerminalKeyAction({ type: "keyup", preventDefault }, action),
		).toBe(false);

		expect(action).toHaveBeenCalledTimes(1);
		expect(preventDefault).toHaveBeenCalledTimes(2);
	});
});

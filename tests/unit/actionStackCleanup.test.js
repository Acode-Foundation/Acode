import { expect, it, vi } from "vitest";
import { loadSourceModule } from "../helpers/loadSourceModule";

it("cleans marked entries top-first without running Back actions or discarding new entries", () => {
	const errors = vi.fn();
	const stack = loadSourceModule(
		"src/lib/actionStack.js",
		{
			"dialogs/confirm": vi.fn(),
			"lib/platform": { appExit: false },
			"lib/settings": { value: {} },
		},
		{ console: { error: errors } },
	).default;
	const back = vi.fn();
	const order = [];
	const failure = new Error("Cleanup failed");
	stack.push({ id: "preserved", action: back });
	stack.setMark();
	stack.push({ id: "page", action: back });
	stack.push({ id: "outer", action: back, onClear: () => order.push("outer") });
	stack.push({
		id: "broken",
		action: back,
		onClear: () => {
			throw failure;
		},
	});
	stack.push({
		id: "inner",
		action: back,
		onClear: () => {
			order.push("inner");
			stack.clearFromMark();
			stack.setMark();
			stack.push({ id: "new", action: back });
		},
	});
	stack.clearFromMark();
	expect(order).toEqual(["inner", "outer"]);
	expect(errors).toHaveBeenCalledExactlyOnceWith(failure);
	expect(back).not.toHaveBeenCalled();
	expect(stack.has("preserved")).toBe(true);
	expect(stack.has("new")).toBe(true);
	expect(stack.length).toBe(2);
	stack.clearFromMark();
	expect(stack.length).toBe(1);
	expect(stack.has("preserved")).toBe(true);
});

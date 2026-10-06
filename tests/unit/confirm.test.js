// @vitest-environment happy-dom

import tag from "html-tag-js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("lib/settings", () => ({
	default: { value: { confirmOnExit: false } },
}));
vi.mock("lib/restoreTheme", () => ({ default: vi.fn() }));
vi.mock("components/checkbox", () => ({
	default: () => document.createElement("input"),
}));
import confirm from "dialogs/confirm";
import actionStack from "lib/actionStack";
beforeEach(() => {
	vi.useFakeTimers();
	vi.clearAllMocks();
	actionStack.setMark();
	document.body.replaceChildren();
	vi.stubGlobal("app", document.body);
	vi.stubGlobal("strings", { ok: "OK", cancel: "Cancel" });
	vi.stubGlobal("tag", tag);
});
afterEach(() => {
	actionStack.clearFromMark();
	vi.runAllTimers();
	vi.restoreAllMocks();
	vi.useRealTimers();
	vi.unstubAllGlobals();
	document.body.replaceChildren();
});
it.each([
	"back",
	"cancel",
	"abort",
])("settles %s as cancellation and cleans the dialog", async (method) => {
	const controller = new AbortController();
	const result = confirm("Icon", "Watch?", false, {
		signal: controller.signal,
	});
	expect(document.querySelector(".confirm").className).toBe("prompt confirm");
	if (method === "back") await actionStack.pop();
	if (method === "cancel") document.querySelector("button").click();
	if (method === "abort") controller.abort();
	await expect(result).resolves.toBe(false);
	vi.runAllTimers();
	expect(app.children.length).toBe(0);
	expect(actionStack.length).toBe(0);
});
it("applies the overlay layer without losing RTL and resolves true", async () => {
	const result = confirm("Delete", "Delete this review?", false, {
		direction: "rtl",
		aboveOverlay: true,
	});
	const dialog = document.querySelector(".confirm");
	expect(dialog.className).toBe("prompt confirm above-overlay");
	expect(dialog.dir).toBe("rtl");
	dialog.querySelectorAll("button")[1].click();
	await expect(result).resolves.toBe(true);
	vi.runAllTimers();
	expect(app.children.length).toBe(0);
	expect(actionStack.length).toBe(0);
});
it("preserves checkbox response and ignores subsequent dismissals", async () => {
	const push = vi.spyOn(actionStack, "push");
	const remove = vi.spyOn(actionStack, "remove");
	const controller = new AbortController();
	const result = confirm("Icon", "Watch?", false, {
		checkboxText: "Remember",
		returnState: true,
		signal: controller.signal,
	});
	document.querySelector("input").checked = true;
	document.querySelectorAll("button")[1].click();
	controller.abort();
	push.mock.calls[0][0].action();
	await expect(result).resolves.toEqual({ confirmed: true, checked: true });
	expect(remove).toHaveBeenCalledOnce();
	expect(actionStack.length).toBe(0);
});

it.each(["back", "cancel", "ok", "abort"])(
	"preserves the lower confirmation's Back handler after %s dismisses the top",
	async (method) => {
		const firstClosed = vi.fn();
		confirm("First", "First confirmation").then(firstClosed);
		const controller = new AbortController();
		const second = confirm("Second", "Second confirmation", false, {
			signal: controller.signal,
		});
		const top = document.querySelectorAll(".confirm")[1];
		if (method === "back") await actionStack.pop();
		if (method === "cancel") top.querySelector("button").click();
		if (method === "ok") top.querySelectorAll("button")[1].click();
		if (method === "abort") controller.abort();
		await expect(second).resolves.toBe(method === "ok");
		vi.runAllTimers();
		expect(document.querySelectorAll(".confirm")).toHaveLength(1);
		expect(actionStack.length).toBe(1);
		expect(firstClosed).not.toHaveBeenCalled();

		await actionStack.pop();
		expect(firstClosed).toHaveBeenCalledExactlyOnceWith(false);
		vi.runAllTimers();
		expect(app.children.length).toBe(0);
		expect(actionStack.length).toBe(0);
	},
);

it("preserves the top confirmation when the lower one is aborted", async () => {
	const controller = new AbortController();
	const first = confirm("First", "First confirmation", false, {
		signal: controller.signal,
	});
	const secondClosed = vi.fn();
	confirm("Second", "Second confirmation").then(secondClosed);
	controller.abort();
	await expect(first).resolves.toBe(false);
	expect(actionStack.length).toBe(1);
	expect(secondClosed).not.toHaveBeenCalled();
	await actionStack.pop();
	expect(secondClosed).toHaveBeenCalledExactlyOnceWith(false);
	vi.runAllTimers();
	expect(app.children.length).toBe(0);
	expect(actionStack.length).toBe(0);
});

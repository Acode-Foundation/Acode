// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import setup from "../helpers/promptDialogs";

afterEach(() => {
	vi.restoreAllMocks();
	document.body.replaceChildren();
	localStorage.clear();
});

it.each([
	"back",
	"cancel",
	"clear",
])("retries a saved paid purchase after %s dismisses the real recovery form", async (dismissal) => {
	const f = setup();
	const underlyingAction = vi.fn();
	f.actionStack.push({ id: "sponsor-page", action: underlyingAction });
	f.actionStack.setMark();
	const recovery = f.service.recoverSponsorPurchases(true);
	let settled = false;
	void recovery.then(() => {
		settled = true;
	});
	await vi.waitFor(() =>
		expect(document.querySelector(".prompt.multi")).not.toBeNull(),
	);
	if (dismissal === "back") await f.actionStack.pop();
	else if (dismissal === "clear") f.actionStack.clearFromMark();
	else document.querySelector(".prompt.multi button[type=button]").click();
	await vi.waitFor(() => expect(settled).toBe(true));
	expect(f.pending.list()).toHaveLength(1);
	expect(f.fetch).not.toHaveBeenCalled();
	expect(f.iap.consume).not.toHaveBeenCalled();
	expect(f.system.setInputType).toHaveBeenLastCalledWith("CODE");
	expect(f.actionStack.length).toBe(1);
	expect(underlyingAction).not.toHaveBeenCalled();

	const retry = f.service.recoverSponsorPurchases(true);
	await vi.waitFor(() =>
		expect(document.querySelector(".prompt.multi:not(.hide)")).not.toBeNull(),
	);
	const form = document.querySelector(".prompt.multi:not(.hide)");
	form.querySelector("#name").value = "Recovered Sponsor";
	form.querySelector("button[type=submit]").click();
	await retry;
	expect(f.fetch).toHaveBeenCalledOnce();
	expect(JSON.parse(f.fetch.mock.calls[0][1].body)).toMatchObject({
		name: "Recovered Sponsor",
		purchaseToken: "paid-token",
	});
	expect(f.iap.consume).toHaveBeenCalledOnce();
	expect(f.pending.list()).toEqual([]);
	expect(f.iap.purchase).not.toHaveBeenCalled();
});

it.each([
	["multi", "single", "back"],
	["single", "multi", "cancel"],
	["single", "single", "submit"],
	["multi", "multi", "submit"],
	["checkbox", "single", "back"],
	["empty", "single", "back"],
])("preserves the outer %s prompt and keyboard after inner %s %s", async (outerType, innerType, dismissal) => {
	const f = setup();
	const open = (type) =>
		type === "single"
			? f.singlePrompt("Name", "Sponsor")
			: f.prompt(
					"Name",
					type === "empty"
						? []
						: type === "checkbox"
							? [{ id: "public", type: "checkbox", value: true }]
							: [{ id: "name", value: "Sponsor" }],
				);
	let outerSettled = false;
	const outer = open(outerType)
		.catch((error) => {
			expect(error).toBeUndefined();
		})
		.then(() => {
			outerSettled = true;
		});
	let innerResult;
	let innerSettled = false;
	const inner = open(innerType)
		.catch((error) => {
			expect(error).toBeUndefined();
			return null;
		})
		.then((result) => {
			innerResult = result;
			innerSettled = true;
		});
	const forms = document.querySelectorAll(".prompt");
	if (dismissal === "back") await f.actionStack.pop();
	else
		forms[1]
			.querySelector(
				`button[type=${dismissal === "submit" ? "submit" : "button"}]`,
			)
			.click();
	await vi.waitFor(() => expect(innerSettled).toBe(true));
	await inner;
	if (dismissal === "back") expect(innerResult).toBeNull();
	expect(outerSettled).toBe(false);
	expect(f.actionStack.length).toBe(1);
	expect(f.system.setInputType).toHaveBeenLastCalledWith("NORMAL");
	await f.actionStack.pop();
	await vi.waitFor(() => expect(outerSettled).toBe(true));
	await outer;
	expect(forms[0].classList.contains("hide")).toBe(true);
	expect(f.actionStack.length).toBe(0);
	expect(f.system.setInputType).toHaveBeenLastCalledWith("CODE");
});

it("settles both prompt types when their marked stack is cleared", async () => {
	const f = setup();
	f.actionStack.setMark();
	const multi = f.prompt("Outer", []).then(
		() => "submitted",
		() => "cancelled",
	);
	const single = f.singlePrompt("Inner", "Sponsor");
	let results;
	void Promise.all([multi, single]).then((values) => {
		results = values;
	});
	f.actionStack.clearFromMark();
	await vi.waitFor(() => expect(results).toEqual(["cancelled", null]));
	expect(document.querySelector("form.prompt:not(.hide)")).toBeNull();
	expect(f.actionStack.length).toBe(0);
	expect(f.system.setInputType).toHaveBeenLastCalledWith("CODE");
});

it.each([
	"click",
	"submit",
])("validates required fields and cleans up numeric prompts on %s", async (method) => {
	const f = setup();
	let settled = false;
	const result = f.singlePrompt("Amount", "5", "number", { required: true });
	void result.then(() => {
		settled = true;
	});
	const form = document.querySelector(".prompt");
	const input = form.querySelector("input");
	const submit = () =>
		method === "click"
			? form.querySelector("button[type=submit]").click()
			: form.dispatchEvent(
					new Event("submit", { bubbles: true, cancelable: true }),
				);
	input.value = "";
	input.dispatchEvent(new Event("input", { bubbles: true }));
	submit();
	await Promise.resolve();
	expect(settled).toBe(false);
	expect(form.querySelector(".error-msg").textContent).toBe("Required");
	expect(form.classList.contains("hide")).toBe(false);
	expect(f.actionStack.length).toBe(1);
	input.value = "7";
	input.dispatchEvent(new Event("input", { bubbles: true }));
	submit();
	expect(await result).toBe(7);
	expect(form.classList.contains("hide")).toBe(true);
	expect(f.actionStack.length).toBe(0);
	expect(f.system.setInputType).toHaveBeenLastCalledWith("CODE");
});

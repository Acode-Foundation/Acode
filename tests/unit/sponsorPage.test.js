// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import setup from "../helpers/sponsorPage";

afterEach(() => {
	document.body.replaceChildren();
	localStorage.clear();
});

it("hides the sponsor CTA and safely rejects direct entry when IAP is absent", () => {
	const fixture = setup(false);
	fixture.Sponsors();
	expect(document.querySelector(".cta-button")).toBeNull();
	expect(() => fixture.Sponsor()).not.toThrow();
	expect(fixture.helpers.error).toHaveBeenCalledWith("product not available");
	expect(fixture.loader.showTitleLoader).not.toHaveBeenCalled();
});

it("keeps the CTA with IAP and shows the loader before synchronous purchase callbacks", async () => {
	const fixture = setup();
	fixture.iap.getPurchases.mockImplementation((success) => {
		expect(fixture.loader.showTitleLoader).toHaveBeenCalledOnce();
		success([]);
	});
	fixture.Sponsors();
	document.querySelector(".cta-button").click();
	await vi.waitFor(() =>
		expect(document.querySelector(".purchase-btn")).not.toBeNull(),
	);
	expect(fixture.loader.removeTitleLoader).toHaveBeenCalled();
	expect(document.body.classList.contains("loading")).toBe(false);
});

it.each([
	true,
	false,
])("opens the native image chooser with all sources on iOS=%s", async (isIOS) => {
	const fixture = setup(true, isIOS);
	const { result, field, finish } = openDetails(fixture);
	expect(field.readOnly).toBe(true);
	field.onclick();
	const picker = document.querySelector('input[type="file"]');
	expect(picker.accept).toBe("image/*");
	expect(picker.multiple).toBe(false);
	expect(picker.hasAttribute("capture")).toBe(!isIOS);
	field.onclick();
	expect(document.querySelectorAll('input[type="file"]')).toHaveLength(1);
	picker.dispatchEvent(new Event("cancel"));
	finish({ name: "Sponsor" });
	expect(await result).toEqual({ name: "Sponsor" });
	expect(picker.isConnected).toBe(false);
	expect(fixture.helpers.error).not.toHaveBeenCalled();
});

it("waits for the selected image before saving details and returning them for purchase", async () => {
	const fixture = setup();
	const { result, field, finish } = openDetails(fixture);
	field.onclick();
	const picker = document.querySelector('input[type="file"]');
	Object.defineProperty(picker, "files", {
		value: [new File(["logo"], "logo.png", { type: "image/png" })],
	});
	picker.dispatchEvent(new Event("change"));
	finish({ name: "Sponsor", image: "" });
	expect(await result).toEqual({
		name: "Sponsor",
		image: "data:image/png;base64,bG9nbw==",
	});
	expect(JSON.parse(localStorage.getItem("sponsor_gold")).image).toBe(
		"data:image/png;base64,bG9nbw==",
	);
	expect(field.value).toBe("logo.png");
	expect(picker.isConnected).toBe(false);
	expect(field.setError).toHaveBeenLastCalledWith("");
});

it.each([
	false,
	true,
])("settles the form without a picker cancel event (form cancelled: %s)", async (cancelled) => {
	const fixture = setup();
	const { result, field, finish } = openDetails(fixture);
	field.onclick();
	const picker = document.querySelector('input[type="file"]');
	finish(cancelled ? null : { name: "Sponsor" });
	expect(await result).toEqual(cancelled ? undefined : { name: "Sponsor" });
	expect(picker.isConnected).toBe(false);
	expect(picker.onchange).toBeNull();
	expect(picker.oncancel).toBeNull();
	expect(localStorage.getItem("sponsor_gold")).toBe(
		cancelled ? null : '{"name":"Sponsor"}',
	);
	expect(fixture.helpers.error).not.toHaveBeenCalled();
});

it("owns purchase errors without replacing legacy listeners and ignores late errors after close", async () => {
	const fixture = setup();
	fixture.Sponsor();
	await vi.waitFor(() =>
		expect(document.querySelector(".purchase-btn")).not.toBeNull(),
	);
	document.querySelector(".purchase-btn").click();
	await vi.waitFor(() => expect(fixture.iap.purchase).toHaveBeenCalledOnce());
	expect(fixture.iap.setPurchaseUpdatedListener).not.toHaveBeenCalled();
	expect(fixture.iap.addPurchaseUpdatedListener).not.toHaveBeenCalled();
	const onError = fixture.iap.purchase.mock.calls[0][3];
	onError(1);
	expect(fixture.helpers.error).not.toHaveBeenCalled();
	expect(document.body.classList.contains("loading")).toBe(false);
	onError(6);
	expect(fixture.helpers.error).toHaveBeenCalledWith(6);
	document.querySelector("section").hide();
	fixture.loader.showTitleLoader();
	fixture.loader.removeTitleLoader.mockClear();
	fixture.helpers.error.mockClear();
	onError(6);
	fixture.iap.purchase.mock.calls[0][2](6);
	expect(fixture.helpers.error).not.toHaveBeenCalled();
	expect(fixture.loader.removeTitleLoader).not.toHaveBeenCalled();
	expect(document.body.classList.contains("loading")).toBe(true);
});

it.each([
	"recovery",
	"details",
	"products",
])("closing the page prevents late %s callbacks from changing UI or charging", async (phase) => {
	const fixture = setup();
	let settle;
	if (phase === "products")
		fixture.iap.getProducts.mockImplementationOnce((ids, success) => {
			settle = () => success([]);
		});
	else if (phase === "recovery")
		fixture.recover.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					settle = () => resolve(new Set());
				}),
		);
	else
		fixture.prompt.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					settle = () => resolve({ name: "Sponsor" });
				}),
		);
	fixture.Sponsor();
	if (phase !== "products") {
		await vi.waitFor(() =>
			expect(document.querySelector(".purchase-btn")).not.toBeNull(),
		);
		document.querySelector(".purchase-btn").click();
		await vi.waitFor(() => expect(settle).toEqual(expect.any(Function)));
	}
	document.querySelector("section").hide();
	fixture.loader.showTitleLoader();
	fixture.loader.removeTitleLoader.mockClear();
	settle();
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(fixture.iap.purchase).not.toHaveBeenCalled();
	expect(fixture.helpers.error).not.toHaveBeenCalled();
	expect(fixture.loader.removeTitleLoader).not.toHaveBeenCalled();
	expect(document.body.classList.contains("loading")).toBe(true);
});

it("keeps the 500KB limit and allows reopening the picker after rejecting a large image", async () => {
	const fixture = setup();
	const { result, field, finish } = openDetails(fixture);
	field.onclick();
	const picker = document.querySelector('input[type="file"]');
	Object.defineProperty(picker, "files", {
		value: [
			new File([new Uint8Array(500001)], "large.jpg", { type: "image/jpeg" }),
		],
	});
	picker.dispatchEvent(new Event("change"));
	await vi.waitFor(() =>
		expect(field.setError).toHaveBeenCalledWith("File size exceeds 500KB"),
	);
	expect(field.value).toBe("");
	field.onclick();
	const replacement = document.querySelector('input[type="file"]');
	expect(replacement).not.toBeNull();
	expect(replacement).not.toBe(picker);
	replacement.dispatchEvent(new Event("cancel"));
	finish({ name: "Sponsor" });
	expect(await result).toEqual({ name: "Sponsor" });
});

it("explains recovery, stores the supplied profile and does not start another purchase", async () => {
	const fixture = setup();
	await fixture.details("gold", "gold", true);
	expect(fixture.prompt.mock.calls[0][0]).toBe("Gold");
	expect(fixture.prompt.mock.calls[0][2]).toContain("already paid");
	expect(fixture.prompt.mock.calls[0][2]).toContain("not be charged again");
	expect(JSON.parse(localStorage.getItem("sponsor_gold"))).toEqual({
		name: "Sponsor",
	});
	expect(fixture.iap.purchase).not.toHaveBeenCalled();
	fixture.prompt.mockRejectedValueOnce(new Error("Cancelled"));
	expect(await fixture.details("crystal", "crystal", true)).toBeUndefined();
	expect(localStorage.getItem("sponsor_crystal")).toBeNull();
});

it.each([
	new Set(["gold"]),
	null,
])("does not start a second charge when recovery finds an existing purchase or cannot query ownership", async (recovered) => {
	const fixture = setup();
	fixture.recover.mockResolvedValue(recovered);
	fixture.Sponsor();
	await vi.waitFor(() =>
		expect(document.querySelector(".purchase-btn")).not.toBeNull(),
	);
	document.querySelector(".purchase-btn").click();
	await vi.waitFor(() => expect(fixture.recover).toHaveBeenCalledOnce());
	await vi.waitFor(() => expect(fixture.helpers.error).toHaveBeenCalledOnce());
	expect(fixture.prompt).not.toHaveBeenCalled();
	expect(fixture.iap.purchase).not.toHaveBeenCalled();
});

function openDetails(fixture) {
	let finish;
	fixture.prompt.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	const result = fixture.details("gold");
	const field = fixture.prompt.mock.calls[0][1].find(
		(field) => field.id === "image",
	);
	field.value = "";
	field.setError = vi.fn();
	return { result, field, finish };
}

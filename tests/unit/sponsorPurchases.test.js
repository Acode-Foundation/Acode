// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import setupSponsorPurchases from "../helpers/sponsorPurchases";

let receive;
let iap;
let fetch;
let success;
let error;
let settled;
let recoverDetails;
const purchase = {
	productIds: ["crystal"],
	purchaseState: 1,
	purchaseToken: "signed-transaction",
};

beforeEach(() => {
	({ receive, iap, fetch, success, error, settled, recoverDetails } =
		setupSponsorPurchases());
});

it("registers the signed transaction before finishing it and clears details only on success", async () => {
	iap.consume.mockImplementation((token, resolve) => {
		expect(fetch).toHaveBeenCalledOnce();
		expect(localStorage.getItem("sponsor_crystal")).not.toBeNull();
		resolve(0);
	});
	await receive([purchase]);
	expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({
		name: "Sponsor",
		tier: "crystal",
		packageName: "app.acode",
		purchaseToken: "signed-transaction",
	});
	expect(iap.consume).toHaveBeenCalledOnce();
	expect(localStorage.getItem("sponsor_crystal")).toBeNull();
	expect(success).toHaveBeenCalledOnce();
	expect(error).not.toHaveBeenCalled();
});

it.each([
	false,
	true,
])("retains an unfinished purchase on HTTP or JSON failure (HTTP ok: %s) and retries", async (ok) => {
	fetch.mockResolvedValueOnce({
		ok,
		json: async () => ({ error: "Purchase not valid" }),
	});
	await receive([purchase]);
	expect(iap.consume).not.toHaveBeenCalled();
	expect(success).not.toHaveBeenCalled();
	expect(error.mock.calls[0][0].message).toBe("Purchase not valid");
	expect(localStorage.getItem("sponsor_crystal")).not.toBeNull();
	await receive([purchase]);
	expect(iap.consume).toHaveBeenCalledOnce();
	expect(success).toHaveBeenCalledOnce();
});

it.each([
	"empty",
	"html",
	"null",
	"array",
	"redirect",
])("retains paid purchases after an unverified %s response and allows retry", async (kind) => {
	fetch.mockResolvedValueOnce({
		ok: true,
		redirected: kind === "redirect",
		json: async () => {
			if (kind === "empty" || kind === "html")
				throw new SyntaxError("Invalid JSON");
			return kind === "null" ? null : kind === "array" ? [] : {};
		},
	});
	await receive([purchase]);
	expect(iap.consume).not.toHaveBeenCalled();
	expect(error).toHaveBeenCalledOnce();
	expect(localStorage.getItem("sponsor_pending_app.acode")).toContain(
		purchase.purchaseToken,
	);
	await receive([]);
	expect(iap.consume).toHaveBeenCalledOnce();
	expect(success).toHaveBeenCalledOnce();
});

it("ignores pending, revoked and unrelated purchases and duplicate deliveries", async () => {
	await receive([
		{ ...purchase, purchaseState: 2 },
		{ ...purchase, purchaseState: 0 },
		{ ...purchase, productIds: ["acode_pro_new"] },
	]);
	expect(fetch).not.toHaveBeenCalled();
	await Promise.all([receive([purchase]), receive([purchase])]);
	await receive([purchase]);
	expect(fetch).toHaveBeenCalledOnce();
	expect(iap.consume).toHaveBeenCalledOnce();
});

it("retains details when StoreKit finishing fails, then retries idempotent registration", async () => {
	iap.consume.mockImplementationOnce((token, resolve, reject) => reject(6));
	await receive([purchase]);
	expect(success).not.toHaveBeenCalled();
	expect(localStorage.getItem("sponsor_crystal")).not.toBeNull();
	await receive([purchase]);
	expect(success).toHaveBeenCalledOnce();
	expect(settled).toHaveBeenCalledTimes(2);
});

it.each([
	null,
	"broken JSON",
	"{}",
	'"invalid details"',
])("recovers a paid transaction with missing or invalid details (%s) before finishing", async (stored) => {
	localStorage.removeItem("sponsor_crystal");
	if (stored !== null) localStorage.setItem("sponsor_crystal", stored);
	await Promise.all([receive([purchase]), receive([purchase])]);
	await receive([purchase]);
	expect(recoverDetails).toHaveBeenCalledExactlyOnceWith(
		"crystal",
		"crystal",
		true,
	);
	expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({
		name: "Recovered Sponsor",
		public: false,
		purchaseToken: purchase.purchaseToken,
	});
	expect(fetch).toHaveBeenCalledOnce();
	expect(iap.consume).toHaveBeenCalledOnce();
});

it("leaves a cancelled recovery unfinished and offers recovery again", async () => {
	localStorage.clear();
	recoverDetails.mockResolvedValueOnce(null);
	await receive([purchase]);
	expect(fetch).not.toHaveBeenCalled();
	expect(iap.consume).not.toHaveBeenCalled();
	expect(success).not.toHaveBeenCalled();
	await receive([purchase]);
	expect(recoverDetails).toHaveBeenCalledTimes(2);
	expect(iap.consume).toHaveBeenCalledOnce();
});

it("retains recovered details after a server failure and retries without prompting again", async () => {
	localStorage.clear();
	fetch.mockRejectedValueOnce(new Error("Offline"));
	await receive([purchase]);
	expect(iap.consume).not.toHaveBeenCalled();
	expect(localStorage.getItem("sponsor_crystal")).not.toBeNull();
	await receive([purchase]);
	expect(recoverDetails).toHaveBeenCalledOnce();
	expect(iap.consume).toHaveBeenCalledOnce();
});

it("continues the batch when one transaction cannot be registered", async () => {
	fetch.mockRejectedValueOnce(new Error("Offline"));
	await receive([
		purchase,
		{ ...purchase, productIds: ["gold"], purchaseToken: "gold-token" },
	]);
	expect(error).toHaveBeenCalledOnce();
	expect(iap.consume).toHaveBeenCalledExactlyOnceWith(
		"gold-token",
		expect.any(Function),
		expect.any(Function),
	);
	expect(localStorage.getItem("sponsor_crystal")).not.toBeNull();
});

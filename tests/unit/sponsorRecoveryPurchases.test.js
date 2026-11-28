// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import setupSponsorPurchases from "../helpers/sponsorPurchases";

const purchase = {
	productIds: ["crystal"],
	purchaseState: 1,
	purchaseToken: "paid-token",
};

it.each([
	"app.acode",
	"com.foxdebug.acodefree",
])("lets a paid %s purchase correct rejected details after reopening", async (packageName) => {
	const f = setupSponsorPurchases(packageName);
	localStorage.setItem(
		"sponsor_crystal",
		JSON.stringify({ name: "x".repeat(201), public: true }),
	);
	f.fetch.mockResolvedValueOnce({
		ok: false,
		status: 400,
		json: async () => ({ error: "Invalid sponsor name.  ", field: "name" }),
	});
	await f.receive([purchase]);
	expect(f.iap.consume).not.toHaveBeenCalled();
	expect(f.pending.list()[0].purchase.purchaseToken).toBe(
		purchase.purchaseToken,
	);
	expect(f.pending.list()[0].details).toBeNull();
	expect(localStorage.getItem("sponsor_crystal")).toBeNull();
	expect(f.error.mock.calls[0][0].message).toBe(
		"Invalid sponsor name. Reopen Sponsorship to correct your details. Your purchase is saved.",
	);
	await f.createReceiver()([]);
	expect(f.recoverDetails).toHaveBeenCalledOnce();
	expect(JSON.parse(f.fetch.mock.calls[1][1].body)).toMatchObject({
		name: "Recovered Sponsor",
		purchaseToken: purchase.purchaseToken,
	});
	expect(f.iap.consume).toHaveBeenCalledOnce();
	expect(f.pending.list()).toEqual([]);
});

it("keeps the paid transaction when correction is cancelled and offers it again", async () => {
	const f = setupSponsorPurchases();
	f.fetch.mockResolvedValueOnce({
		ok: false,
		status: 400,
		json: async () => ({ error: "Invalid sponsor website", field: "website" }),
	});
	await f.receive([purchase]);
	f.recoverDetails.mockResolvedValueOnce(null);
	await f.createReceiver()([]);
	expect(f.iap.consume).not.toHaveBeenCalled();
	expect(f.pending.list()).toHaveLength(1);
	await f.createReceiver()([]);
	expect(f.iap.consume).toHaveBeenCalledOnce();
});

it("preserves a newer draft when an earlier profile is rejected", async () => {
	const f = setupSponsorPurchases();
	const corrected = JSON.stringify({ name: "Updated Sponsor", public: false });
	f.fetch.mockImplementationOnce(async () => {
		localStorage.setItem("sponsor_crystal", corrected);
		return {
			ok: false,
			status: 400,
			json: async () => ({ error: "Invalid name" }),
		};
	});
	await f.receive([purchase]);
	expect(localStorage.getItem("sponsor_crystal")).toBe(corrected);
	expect(f.pending.list()[0].details).toBeNull();
	expect(f.iap.consume).not.toHaveBeenCalled();
});

it.each([
	"app.acode",
	"com.foxdebug.acodefree",
])("recovers a paid %s purchase after restart without another purchase or lost details", async (packageName) => {
	const f = setupSponsorPurchases(packageName);
	f.fetch.mockRejectedValueOnce(new Error("Connection lost during restart"));
	await f.receive([purchase]);
	expect(f.pending.list()).toHaveLength(1);
	localStorage.removeItem("sponsor_crystal");
	const restarted = f.createReceiver();
	await restarted([]);
	expect(f.recoverDetails).not.toHaveBeenCalled();
	expect(JSON.parse(f.fetch.mock.calls[1][1].body)).toMatchObject({
		name: "Sponsor",
		packageName,
		purchaseToken: "paid-token",
	});
	expect(f.iap.consume).toHaveBeenCalledOnce();
	expect(f.pending.list()).toEqual([]);
});

it("persists all paid transactions before opening a recovery prompt", async () => {
	const f = setupSponsorPurchases();
	localStorage.clear();
	f.recoverDetails.mockImplementationOnce(() => new Promise(() => {}));
	void f.receive([
		purchase,
		{ ...purchase, productIds: ["gold"], purchaseToken: "gold-token" },
	]);
	expect(f.pending.list()).toHaveLength(2);
	const restarted = f.createReceiver();
	await restarted([]);
	expect(f.iap.consume).toHaveBeenCalledTimes(2);
	expect(f.pending.list()).toEqual([]);
});

it("retains server registration across a restart after finishing, even when the store no longer owns it", async () => {
	const f = setupSponsorPurchases();
	f.iap.consume.mockImplementationOnce((token, resolve, reject) => reject(6));
	await f.receive([purchase]);
	expect(f.pending.list()[0].registered).toBe("https://example.test/api");
	f.iap.consume.mockImplementationOnce((token, resolve, reject) => reject(8));
	await f.createReceiver()([]);
	expect(f.fetch).toHaveBeenCalledOnce();
	expect(f.success).toHaveBeenCalledOnce();
	expect(f.pending.list()).toEqual([]);
});

it("does not finish a purchase that the server rejected, even if it is no longer owned", async () => {
	const f = setupSponsorPurchases();
	f.fetch.mockResolvedValue({
		ok: false,
		json: async () => ({ error: "Invalid purchase" }),
	});
	await f.receive([purchase]);
	await f.createReceiver()([]);
	expect(f.iap.consume).not.toHaveBeenCalled();
	expect(f.pending.list()).toHaveLength(1);
});

it("deduplicates re-signed StoreKit transactions using their transaction identity", async () => {
	const f = setupSponsorPurchases();
	const apple = {
		...purchase,
		store: "appstore",
		transactionId: "42",
		environment: "Sandbox",
	};
	await Promise.all([
		f.receive([apple]),
		f.receive([{ ...apple, purchaseToken: "new-signature" }]),
	]);
	await f.receive([{ ...apple, purchaseToken: "another-signature" }]);
	expect(f.fetch).toHaveBeenCalledOnce();
	expect(f.iap.consume).toHaveBeenCalledOnce();
});

it("keeps each transaction's profile separate from later drafts for the same tier", async () => {
	const f = setupSponsorPurchases();
	f.fetch.mockRejectedValueOnce(new Error("Offline"));
	await f.receive([purchase]);
	localStorage.setItem(
		"sponsor_crystal",
		JSON.stringify({ name: "Later Sponsor" }),
	);
	await f.createReceiver()([]);
	expect(JSON.parse(f.fetch.mock.calls[1][1].body).name).toBe("Sponsor");
	expect(JSON.parse(localStorage.getItem("sponsor_crystal")).name).toBe(
		"Later Sponsor",
	);
});

it("does not repeatedly prompt after cancellation on resume, but allows explicit recovery and restart", async () => {
	const f = setupSponsorPurchases();
	localStorage.clear();
	f.recoverDetails.mockResolvedValueOnce(null);
	await f.receive([purchase], false);
	await f.receive([purchase], false);
	expect(f.recoverDetails).toHaveBeenCalledOnce();
	await f.receive([], true);
	expect(f.recoverDetails).toHaveBeenCalledTimes(2);
	expect(f.pending.list()).toEqual([]);
});

it("does not process another app's saved purchases", async () => {
	const f = setupSponsorPurchases("app.acode");
	f.fetch.mockRejectedValueOnce(new Error("Offline"));
	await f.receive([purchase]);
	localStorage.setItem(
		"sponsor_pending_com.foxdebug.acodefree",
		JSON.stringify(f.pending.list()),
	);
	localStorage.removeItem("sponsor_pending_app.acode");
	await f.createReceiver()([]);
	expect(f.iap.consume).not.toHaveBeenCalled();
});

it("retains a server-confirmed purchase if the finish callback is lost, then recovers it after restart", async () => {
	vi.useFakeTimers();
	try {
		const f = setupSponsorPurchases();
		f.iap.consume.mockImplementationOnce(() => {});
		const stalled = f.receive([purchase]);
		await vi.advanceTimersByTimeAsync(5000);
		await stalled;
		expect(f.pending.list()[0].registered).toBe("https://example.test/api");
		f.iap.consume.mockImplementationOnce((token, resolve, reject) => reject(8));
		await f.createReceiver()([]);
		expect(f.fetch).toHaveBeenCalledOnce();
		expect(f.pending.list()).toEqual([]);
	} finally {
		vi.useRealTimers();
	}
});

it("aborts stalled registration without finishing the purchase, and retries later", async () => {
	vi.useFakeTimers();
	try {
		const f = setupSponsorPurchases();
		f.fetch.mockImplementationOnce(
			(url, { signal }) =>
				new Promise((resolve, reject) => {
					signal.addEventListener("abort", () =>
						reject(new Error("Request timed out")),
					);
				}),
		);
		const stalled = f.receive([purchase]);
		await vi.advanceTimersByTimeAsync(15000);
		await stalled;
		expect(f.iap.consume).not.toHaveBeenCalled();
		expect(f.pending.list()).toHaveLength(1);
		await f.receive([]);
		expect(f.pending.list()).toEqual([]);
	} finally {
		vi.useRealTimers();
	}
});

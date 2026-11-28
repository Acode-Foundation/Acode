// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { loadSourceModule } from "../helpers/loadSourceModule";
import setupSponsorPurchases from "../helpers/sponsorPurchases";

const purchase = {
	productIds: ["crystal"],
	purchaseState: 1,
	purchaseToken: "paid-token",
};

it.each([
	"app.acode",
	"com.foxdebug.acodefree",
])("recovers unfinished %s sponsorship on startup without visiting the page", async (packageName) => {
	const f = setup(packageName);
	localStorage.clear();
	const recovered = await f.service.default();
	expect(recovered.has("crystal")).toBe(true);
	expect(f.recoverDetails).toHaveBeenCalledOnce();
	expect(f.fetch).toHaveBeenCalledOnce();
	expect(f.iap.consume).toHaveBeenCalledOnce();
	expect(f.iap.purchase).not.toHaveBeenCalled();
	expect(f.pending.list()).toEqual([]);
});

it.each([
	"resume",
	"online",
])("retries a failed registration on %s, preserving the original profile", async (event) => {
	const f = setup();
	f.fetch.mockRejectedValueOnce(new Error("Offline"));
	await f.service.default();
	expect(f.pending.list()).toHaveLength(1);
	(event === "resume" ? f.document : f.window).dispatchEvent(new Event(event));
	await vi.waitFor(() => expect(f.pending.list()).toEqual([]));
	expect(f.recoverDetails).not.toHaveBeenCalled();
	expect(f.iap.consume).toHaveBeenCalledOnce();
});

it("handles delayed approval through the persistent observer while the sponsor page is closed", async () => {
	const f = setup();
	f.iap.getPurchases.mockImplementation((success) => success([]));
	await f.service.default();
	await f.iap.addPurchaseUpdatedListener.mock.calls[0][0]([purchase]);
	expect(f.iap.consume).toHaveBeenCalledOnce();
	expect(f.dialog).toHaveBeenCalledOnce();
});

it("shares one recovery operation and one observer across startup and page entry", async () => {
	const f = setup();
	await Promise.all([
		f.service.default(),
		f.service.default(true),
		f.service.recoverSponsorPurchases(true),
	]);
	expect(f.iap.addPurchaseUpdatedListener).toHaveBeenCalledOnce();
	expect(f.iap.getPurchases).toHaveBeenCalledOnce();
	expect(f.fetch).toHaveBeenCalledOnce();
});

it("keeps cancellation quiet on resume, but offers the form again on explicit page entry", async () => {
	const f = setup();
	localStorage.clear();
	f.recoverDetails.mockResolvedValueOnce(null);
	await f.service.default();
	await f.service.recoverSponsorPurchases();
	expect(f.recoverDetails).toHaveBeenCalledOnce();
	await f.service.recoverSponsorPurchases(true);
	expect(f.recoverDetails).toHaveBeenCalledTimes(2);
	expect(f.iap.consume).toHaveBeenCalledOnce();
});

it("retries a durable transaction when store lookup fails, and blocks a new charge", async () => {
	const f = setup();
	f.fetch.mockRejectedValueOnce(new Error("Offline"));
	await f.service.default();
	f.iap.startConnection.mockImplementation((success, failure) => failure(2));
	f.iap.getPurchases.mockImplementation((success, failure) => failure(2));
	const recovered = await f.service.recoverSponsorPurchases(true);
	expect(recovered).toBeNull();
	expect(f.iap.consume).toHaveBeenCalledOnce();
	expect(f.pending.list()).toEqual([]);
});

it("does nothing when the app has no IAP service", async () => {
	const f = setup(undefined, false);
	expect(await f.service.default()).toBeNull();
	expect(f.iap.startConnection).not.toHaveBeenCalled();
	expect(f.iap.addPurchaseUpdatedListener).not.toHaveBeenCalled();
});

it("recovers existing StoreKit receipts even when new payments are restricted", async () => {
	const f = setup();
	f.iap.startConnection.mockImplementation((success, failure) => failure(3));
	await f.service.default();
	expect(f.iap.getPurchases).toHaveBeenCalledOnce();
	expect(f.iap.consume).toHaveBeenCalledOnce();
});

it("honors explicit recovery while a background store query is in flight", async () => {
	const f = setup();
	localStorage.clear();
	f.recoverDetails.mockResolvedValueOnce(null);
	await f.service.default();
	let finishQuery;
	f.iap.getPurchases.mockImplementationOnce((success) => {
		finishQuery = success;
	});
	const background = f.service.recoverSponsorPurchases();
	const explicit = f.service.recoverSponsorPurchases(true);
	finishQuery([purchase]);
	await Promise.all([background, explicit]);
	expect(f.recoverDetails).toHaveBeenCalledTimes(2);
	expect(f.iap.getPurchases).toHaveBeenCalledTimes(2);
	expect(f.iap.consume).toHaveBeenCalledOnce();
});

it("honors an explicit retry arriving while the background recovery form is open", async () => {
	const f = setup();
	localStorage.clear();
	let cancel;
	f.recoverDetails.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				cancel = resolve;
			}),
	);
	const background = f.service.default();
	await vi.waitFor(() => expect(f.recoverDetails).toHaveBeenCalledOnce());
	const explicit = f.service.recoverSponsorPurchases(true);
	cancel(null);
	await Promise.all([background, explicit]);
	expect(f.recoverDetails).toHaveBeenCalledTimes(2);
	expect(f.iap.getPurchases).toHaveBeenCalledOnce();
	expect(f.iap.consume).toHaveBeenCalledOnce();
});

it("retries observer registration after a bridge failure without duplicating lifecycle listeners", async () => {
	const f = setup();
	f.iap.addPurchaseUpdatedListener.mockImplementationOnce(() => {
		throw new Error("Bridge unavailable");
	});
	await f.service.default();
	await f.service.default();
	expect(f.iap.addPurchaseUpdatedListener).toHaveBeenCalledTimes(2);
	f.document.dispatchEvent(new Event("resume"));
	await vi.waitFor(() => expect(f.iap.getPurchases).toHaveBeenCalledTimes(3));
});

it("times out an unresponsive store so later resume can query again", async () => {
	vi.useFakeTimers();
	try {
		const f = setup();
		f.iap.startConnection.mockImplementationOnce(() => {});
		const stalled = f.service.default();
		await vi.advanceTimersByTimeAsync(5000);
		expect(await stalled).toBeNull();
		await f.service.recoverSponsorPurchases();
		expect(f.iap.consume).toHaveBeenCalledOnce();
	} finally {
		vi.useRealTimers();
	}
});

it("includes a purchase delivered and finished while the store query is pending", async () => {
	const f = setup();
	let finishQuery;
	f.iap.getPurchases.mockImplementationOnce((success) => {
		finishQuery = success;
	});
	const recovery = f.service.default();
	await f.iap.addPurchaseUpdatedListener.mock.calls[0][0]([purchase]);
	expect(f.pending.list()).toEqual([]);
	finishQuery([]);
	expect((await recovery).has("crystal")).toBe(true);
	f.iap.getPurchases.mockImplementationOnce((success) => success([]));
	expect((await f.service.recoverSponsorPurchases()).size).toBe(0);
});

it.each([
	false,
	true,
])("includes a purchase delivered during processing (registration succeeds: %s)", async (succeeds) => {
	const f = setup();
	let finishRegistration;
	f.fetch.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				finishRegistration = resolve;
			}),
	);
	const recovery = f.service.default();
	await vi.waitFor(() => expect(f.fetch).toHaveBeenCalledOnce());
	if (!succeeds) f.fetch.mockRejectedValueOnce(new Error("Offline"));
	const delivery = f.iap.addPurchaseUpdatedListener.mock.calls[0][0]([
		{ ...purchase, productIds: ["gold"], purchaseToken: "gold-token" },
	]);
	finishRegistration({ ok: true, json: async () => ({}) });
	const [products] = await Promise.all([recovery, delivery]);
	expect([...products]).toEqual(["crystal", "gold"]);
	expect(f.pending.list()).toHaveLength(succeeds ? 0 : 1);
	expect(f.iap.consume).toHaveBeenCalledTimes(succeeds ? 2 : 1);
});

function setup(packageName = "app.acode", available = true) {
	const fixture = setupSponsorPurchases(packageName);
	const document = new EventTarget();
	const window = new EventTarget();
	const dialog = vi.fn();
	Object.assign(fixture.iap, {
		startConnection: vi.fn((success) => success(0)),
		getPurchases: vi.fn((success) => success([purchase])),
		addPurchaseUpdatedListener: vi.fn(),
		purchase: vi.fn(),
	});
	const service = loadSourceModule(
		"src/pages/sponsor/recovery.js",
		{
			"dialogs/dialog": dialog,
			"utils/helpers": { error: fixture.error },
			"./pending": fixture.pending,
			"./purchases": fixture.createProcessor,
		},
		{
			document,
			window,
			setTimeout,
			clearTimeout,
			strings: { info: "Info" },
			console: { warn: vi.fn(), error: vi.fn() },
			...(available ? { iap: fixture.iap } : {}),
		},
	);
	return { ...fixture, document, window, dialog, service };
}

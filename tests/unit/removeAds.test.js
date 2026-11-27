import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	config: { HAS_PRO: false, BASE_URL: "https://acode.app" },
	alert: vi.fn(),
	suppress: vi.fn(),
	confirm: vi.fn(),
	customTab: vi.fn(),
	auth: { getLoggedInUser: vi.fn(), login: vi.fn() },
	loader: { create: vi.fn(), show: vi.fn(), destroy: vi.fn() },
	external: false,
}));
vi.mock("dialogs/alert", () => ({ default: mocks.alert }));
vi.mock("dialogs/confirm", () => ({ default: mocks.confirm }));
vi.mock("dialogs/loader", () => ({ default: mocks.loader }));
vi.mock("utils/helpers", () => ({
	default: {
		error: vi.fn(),
		shouldAllowExternalPurchase: () => mocks.external,
	},
}));
vi.mock("lib/auth", () => ({ default: mocks.auth }));
vi.mock("lib/config", () => ({ default: mocks.config }));
vi.mock("lib/customTab", () => ({ default: mocks.customTab }));
vi.mock("lib/startAd", () => ({
	BANNER_SUPPRESSION_REASON: { PRO: "pro" },
	setBannerSuppressed: mocks.suppress,
}));

import removeAds, { requestProPurchase, restorePurchases } from "lib/removeAds";

let purchaseUpdated;
let purchaseError;
beforeEach(() => {
	vi.clearAllMocks();
	mocks.config.HAS_PRO = false;
	mocks.external = false;
	mocks.auth.getLoggedInUser
		.mockReset()
		.mockResolvedValue({ acode_pro: false });
	mocks.auth.login.mockResolvedValue();
	mocks.confirm.mockResolvedValue(true);
	mocks.customTab.mockResolvedValue();
	vi.stubGlobal("strings", {
		"remove ads": "Remove ads",
		"loading...": "Loading...",
		"no-product-info": "No product",
		"purchase pending": "Pending",
		failed: "Failed",
		success: "Success",
		canceled: "Cancelled",
		"thank you :)": "Thanks",
		"confirm-login": "Login?",
	});
	vi.stubGlobal("localStorage", { setItem: vi.fn() });
	vi.stubGlobal("iap", {
		USER_CANCELED: 1,
		ITEM_ALREADY_OWNED: 7,
		PURCHASE_STATE_PURCHASED: 1,
		PURCHASE_STATE_PENDING: 2,
		getProducts: vi.fn((ids, ok) => ok([{ productId: "acode_pro_new" }])),
		setPurchaseUpdatedListener: vi.fn((ok, fail) => {
			purchaseUpdated = ok;
			purchaseError = fail;
		}),
		purchase: vi.fn(),
		acknowledgePurchase: vi.fn((token, ok) => ok()),
	});
});

describe("shared Pro purchase flow", () => {
	it("shows loading immediately through product lookup, billing, and acknowledgement", async () => {
		let productsLoaded;
		let acknowledged;
		iap.getProducts.mockImplementation((ids, ok) => {
			expect(mocks.loader.create).toHaveBeenCalledExactlyOnceWith(
				"Remove ads",
				"Loading...",
			);
			productsLoaded = ok;
		});
		iap.purchase.mockImplementation((id, ok) => ok());
		iap.acknowledgePurchase.mockImplementation((token, ok) => {
			acknowledged = ok;
		});
		const result = requestProPurchase();
		expect(mocks.loader.destroy).not.toHaveBeenCalled();
		productsLoaded([{ productId: "acode_pro_new" }]);
		await Promise.resolve();
		expect(mocks.loader.destroy).not.toHaveBeenCalled();
		purchaseUpdated([
			{
				productIds: ["acode_pro_new"],
				purchaseState: 1,
				isAcknowledged: false,
				purchaseToken: "pro",
			},
		]);
		await Promise.resolve();
		expect(mocks.loader.destroy).not.toHaveBeenCalled();
		expect(mocks.config.HAS_PRO).toBe(false);
		expect(mocks.alert).not.toHaveBeenCalled();
		acknowledged();
		await expect(result).resolves.toBe(true);
		expect(mocks.loader.destroy).toHaveBeenCalledOnce();
		expect(mocks.alert).toHaveBeenCalledExactlyOnceWith("Success", "Thanks");
	});
	it("dismisses loading on acknowledgement failure and allows a new attempt", async () => {
		iap.acknowledgePurchase.mockImplementation((token, ok, fail) => fail(6));
		const result = requestProPurchase();
		const assertion = expect(result).rejects.toBe(6);
		purchaseUpdated([
			{
				productIds: ["acode_pro_new"],
				purchaseState: 1,
				isAcknowledged: false,
				purchaseToken: "pro",
			},
		]);
		await assertion;
		expect(mocks.loader.destroy).toHaveBeenCalledOnce();
		expect(mocks.config.HAS_PRO).toBe(false);
		const retry = requestProPurchase();
		expect(mocks.loader.create).toHaveBeenCalledTimes(2);
		purchaseError(iap.USER_CANCELED);
		await expect(retry).resolves.toBe(false);
		expect(mocks.loader.destroy).toHaveBeenCalledTimes(2);
	});
	it("ignores updates for other products before granting the requested Pro purchase", async () => {
		const pending = removeAds();
		purchaseUpdated([
			{
				productIds: ["other_plugin"],
				purchaseState: 1,
				isAcknowledged: false,
				purchaseToken: "other",
			},
		]);
		expect(mocks.config.HAS_PRO).toBe(false);
		expect(iap.acknowledgePurchase).not.toHaveBeenCalled();
		purchaseUpdated([
			{ productIds: ["other_plugin"], purchaseState: 1, isAcknowledged: true },
			{
				productIds: ["acode_pro_new"],
				purchaseState: 1,
				isAcknowledged: false,
				purchaseToken: "pro",
			},
		]);
		await pending;
		expect(mocks.config.HAS_PRO).toBe(true);
		expect(iap.acknowledgePurchase).toHaveBeenCalledWith(
			"pro",
			expect.any(Function),
			expect.any(Function),
		);
	});
	it("restores Pro only after a purchased entitlement is acknowledged", async () => {
		iap.restorePurchases = vi.fn((ok) =>
			ok([
				{
					productIds: ["acode_pro_new"],
					purchaseState: 1,
					isAcknowledged: false,
					purchaseToken: "restored",
				},
			]),
		);
		await restorePurchases();
		expect(iap.acknowledgePurchase).toHaveBeenCalledWith(
			"restored",
			expect.any(Function),
			expect.any(Function),
		);
		expect(mocks.config.HAS_PRO).toBe(true);
		expect(mocks.suppress).toHaveBeenCalledWith("pro", true);
		expect(localStorage.setItem).toHaveBeenCalledWith("acode_pro", "true");
	});
	it.each([
		{ label: "missing purchases", purchases: [] },
		{
			label: "pending purchases",
			purchases: [{ productIds: ["acode_pro_new"], purchaseState: 2 }],
		},
		{
			label: "plugin purchases",
			purchases: [{ productIds: ["plugin"], purchaseState: 1 }],
		},
	])("does not grant Pro from $label", async ({ purchases }) => {
		iap.restorePurchases = vi.fn((ok) => ok(purchases));
		await restorePurchases();
		expect(mocks.config.HAS_PRO).toBe(false);
		expect(mocks.suppress).not.toHaveBeenCalled();
	});
	it("does not grant restored Pro if acknowledgement fails", async () => {
		iap.restorePurchases = vi.fn((ok) =>
			ok([
				{
					productIds: ["acode_pro_new"],
					purchaseState: 1,
					isAcknowledged: false,
					purchaseToken: "restored",
				},
			]),
		);
		iap.acknowledgePurchase.mockImplementation((token, ok, fail) => fail(6));
		await expect(restorePurchases()).rejects.toBe(6);
		expect(mocks.config.HAS_PRO).toBe(false);
	});
	it.each([
		"empty products",
		"product error",
		"product exception",
		"launch error",
		"empty purchase",
		"pending",
		"cancel",
	])("settles %s without granting Pro", async (kind) => {
		if (kind === "empty products")
			iap.getProducts.mockImplementation((ids, ok) => ok([]));
		if (kind === "product error")
			iap.getProducts.mockImplementation((ids, ok, fail) =>
				fail("Products failed"),
			);
		if (kind === "product exception")
			iap.getProducts.mockImplementation(() => {
				throw new Error("Billing unavailable");
			});
		if (kind === "launch error")
			iap.purchase.mockImplementation((id, ok, fail) => fail("Launch failed"));
		const pending = removeAds();
		const assertion = expect(pending).rejects.toBeDefined();
		if (kind === "empty purchase") purchaseUpdated([]);
		if (kind === "pending")
			purchaseUpdated([{ productIds: ["acode_pro_new"], purchaseState: 2 }]);
		if (kind === "cancel") purchaseError(1);
		await assertion;
		expect(mocks.loader.destroy).toHaveBeenCalledOnce();
		expect(mocks.config.HAS_PRO).toBe(false);
		expect(mocks.suppress).not.toHaveBeenCalled();
		expect(mocks.alert).not.toHaveBeenCalled();
	});
	it("shares an active billing request and grants Pro once after acknowledgement", async () => {
		const first = removeAds();
		const duplicate = removeAds();
		expect(duplicate).toBe(first);
		expect(mocks.loader.create).toHaveBeenCalledOnce();
		const value = [
			{
				productIds: ["acode_pro_new"],
				purchaseState: 1,
				isAcknowledged: false,
				purchaseToken: "test",
			},
		];
		purchaseUpdated(value);
		await first;
		purchaseUpdated(value);
		expect(iap.purchase).toHaveBeenCalledOnce();
		expect(mocks.loader.destroy).toHaveBeenCalledOnce();
		expect(mocks.config.HAS_PRO).toBe(true);
		expect(mocks.alert).toHaveBeenCalledExactlyOnceWith("Success", "Thanks");
		expect(mocks.suppress).toHaveBeenCalledWith("pro", true);
	});
	it("treats cancelled billing as a cancelled request", async () => {
		const result = requestProPurchase();
		purchaseError(1);
		await expect(result).resolves.toBe(false);
	});
	it("honors a later confirmed purchase after reporting its pending state", async () => {
		const result = removeAds();
		const assertion = expect(result).rejects.toBe("Pending");
		purchaseUpdated([{ productIds: ["acode_pro_new"], purchaseState: 2 }]);
		await assertion;
		expect(mocks.config.HAS_PRO).toBe(false);
		purchaseUpdated([
			{ productIds: ["acode_pro_new"], purchaseState: 1, isAcknowledged: true },
		]);
		expect(mocks.config.HAS_PRO).toBe(true);
		expect(mocks.alert).toHaveBeenCalledExactlyOnceWith("Success", "Thanks");
	});
	it("cancels pending product lookup and ignores its late result", async () => {
		let productsLoaded;
		iap.getProducts.mockImplementation((ids, ok) => {
			productsLoaded = ok;
		});
		const controller = new AbortController();
		const result = requestProPurchase({ signal: controller.signal });
		controller.abort();
		await expect(result).resolves.toBe(false);
		productsLoaded([{ productId: "acode_pro_new" }]);
		expect(mocks.loader.destroy).toHaveBeenCalledOnce();
		expect(iap.purchase).not.toHaveBeenCalled();
		expect(mocks.config.HAS_PRO).toBe(false);
	});
	it("uses the existing external checkout and does not grant Pro merely for opening it", async () => {
		mocks.external = true;
		await expect(requestProPurchase()).resolves.toBe(false);
		expect(mocks.customTab).toHaveBeenCalledWith(
			"https://acode.app/pro?redirect=app",
		);
		expect(iap.purchase).not.toHaveBeenCalled();
		expect(mocks.loader.destroy).toHaveBeenCalledOnce();
	});
	it("refreshes confirmed account Pro without checkout", async () => {
		mocks.external = true;
		mocks.auth.getLoggedInUser.mockResolvedValue({ acode_pro: true });
		await expect(requestProPurchase()).resolves.toBe(true);
		expect(mocks.config.HAS_PRO).toBe(true);
		expect(mocks.customTab).not.toHaveBeenCalled();
	});
	it("honors login cancellation and page closure before checkout", async () => {
		mocks.external = true;
		mocks.auth.getLoggedInUser.mockResolvedValue(null);
		mocks.confirm.mockResolvedValue(false);
		await expect(requestProPurchase()).resolves.toBe(false);
		expect(mocks.auth.login).not.toHaveBeenCalled();
		const controller = new AbortController();
		mocks.auth.getLoggedInUser.mockImplementation(async () => {
			controller.abort();
			return { acode_pro: false };
		});
		await expect(
			requestProPurchase({ signal: controller.signal }),
		).resolves.toBe(false);
		expect(mocks.customTab).not.toHaveBeenCalled();
	});
});

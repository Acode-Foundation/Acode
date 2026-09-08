import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
	config: { HAS_PRO: false, BASE_URL: "https://acode.app" },
	toast: vi.fn(),
	suppress: vi.fn(),
	confirm: vi.fn(),
	customTab: vi.fn(),
	auth: { getLoggedInUser: vi.fn(), login: vi.fn() },
	loader: { create: vi.fn(), show: vi.fn(), destroy: vi.fn() },
	external: false,
}));
vi.mock("components/toast", () => ({ default: mocks.toast }));
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
import removeAds, { requestProPurchase } from "lib/removeAds";
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
		"no-product-info": "No product",
		"purchase pending": "Pending",
		failed: "Failed",
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
		if (kind === "pending") purchaseUpdated([{ purchaseState: 2 }]);
		if (kind === "cancel") purchaseError(1);
		await assertion;
		expect(mocks.config.HAS_PRO).toBe(false);
		expect(mocks.suppress).not.toHaveBeenCalled();
	});
	it("shares an active billing request and grants Pro once after acknowledgement", async () => {
		const first = removeAds();
		const duplicate = removeAds();
		expect(duplicate).toBe(first);
		const value = [
			{ purchaseState: 1, isAcknowledged: false, purchaseToken: "test" },
		];
		purchaseUpdated(value);
		await first;
		purchaseUpdated(value);
		expect(iap.purchase).toHaveBeenCalledOnce();
		expect(mocks.config.HAS_PRO).toBe(true);
		expect(mocks.toast).toHaveBeenCalledOnce();
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
		purchaseUpdated([{ purchaseState: 2 }]);
		await assertion;
		expect(mocks.config.HAS_PRO).toBe(false);
		purchaseUpdated([{ purchaseState: 1, isAcknowledged: true }]);
		expect(mocks.config.HAS_PRO).toBe(true);
		expect(mocks.toast).toHaveBeenCalledOnce();
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

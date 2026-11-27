import { afterEach, expect, test, vi } from "vitest";

vi.mock("fileSystem", () => ({ default: vi.fn() }));
vi.mock("dialogs/alert", () => ({ default: vi.fn() }));
vi.mock("lib/adRewards", () => ({ default: {} }));
vi.mock("lib/config", () => ({ default: {} }));
vi.mock("lib/fileIcons", () => ({ default: {} }));
vi.mock("lib/startAd", () => ({
	interstitialAd: {},
	requestBannerForPage: vi.fn(),
}));

import helpers from "utils/helpers";

afterEach(() => vi.unstubAllGlobals());

test("unavailable iOS billing does not offer the Android external checkout fallback", () => {
	vi.stubGlobal("Bridge", { platformId: "ios" });
	vi.stubGlobal("window", {});
	vi.stubGlobal("iap", { isIapAvailable: () => false });
	expect(helpers.shouldAllowExternalPurchase()).toBe(false);
	vi.stubGlobal("Bridge", { platformId: "android" });
	expect(helpers.shouldAllowExternalPurchase()).toBe(true);
	window.appInstallSource = "com.android.vending";
	expect(helpers.shouldAllowExternalPurchase()).toBe(false);
	window.appInstallSource = "";
	iap.isIapAvailable = () => true;
	expect(helpers.shouldAllowExternalPurchase()).toBe(false);
});

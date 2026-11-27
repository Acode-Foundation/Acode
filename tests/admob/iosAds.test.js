import { createRequire } from "node:module";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const require = createRequire(import.meta.url);
const { getAdConfig } = require("../../dev/config.js");
const ads = require("../../ads.json");
const banner = { on: vi.fn() };
const interstitial = { load: vi.fn().mockResolvedValue(), on: vi.fn() };

vi.mock("../../src/lib/bannerVisibilityController.mjs", () => ({
	BANNER_SUPPRESSION_REASON: {},
	bannerVisibilityController: { setBanner: vi.fn() },
}));
vi.mock("../../src/lib/config", () => ({ default: { HAS_PRO: false } }));

beforeEach(async () => {
	vi.resetModules();
	vi.stubGlobal(
		"window",
		Object.assign(new EventTarget(), { ANDROID_SDK_INT: 0 }),
	);
	vi.stubGlobal(
		"document",
		Object.assign(new EventTarget(), { hidden: false }),
	);
	vi.stubGlobal("navigator", { onLine: true });
	const config = await import("../../src/lib/config");
	config.default.HAS_PRO = false;
	vi.stubGlobal("Bridge", { platformId: "ios" });
	vi.stubGlobal("BuildInfo", { buildType: "debug" });
	setBuildConstants("ios", "Debug");
	vi.stubGlobal("admob", {
		privacy: {
			gatherConsent: vi.fn().mockResolvedValue({
				consentStatus: "notRequired",
				canRequestAds: true,
			}),
		},
		start: vi.fn().mockResolvedValue(),
		configure: vi.fn().mockResolvedValue(),
		BannerAd: vi.fn(function () {
			return banner;
		}),
		InterstitialAd: vi.fn(function () {
			return interstitial;
		}),
	});
});
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
	vi.clearAllMocks();
});

test.each([
	["ios", "Debug"],
	["ios", "Release"],
	["android", "Debug"],
	["android", "Release"],
])("%s %s initializes after consent using its compiled IDs", async (platform, mode) => {
	setBuildConstants(platform, mode);
	window.ANDROID_SDK_INT = platform === "android" ? 29 : 0;
	const ids = getAdConfig(platform, mode);
	const { default: startAd, adUnitIdRewarded } = await import(
		"../../src/lib/startAd.js"
	);
	await startAd();
	expect(admob.privacy.gatherConsent).toHaveBeenCalledOnce();
	expect(admob.start).toHaveBeenCalledOnce();
	expect(admob.BannerAd).toHaveBeenCalledWith({
		adUnitId: ids.banner,
		position: "bottom",
	});
	expect(admob.InterstitialAd).toHaveBeenCalledWith({
		adUnitId: ids.interstitial,
	});
	expect(adUnitIdRewarded).toBe(ids.rewarded);
	expect(window.adRewardedUnitId).toBe(adUnitIdRewarded);
});

test("iOS does not initialize ads when consent is unavailable", async () => {
	admob.privacy.gatherConsent.mockResolvedValue({
		consentStatus: "required",
		canRequestAds: false,
	});
	const { default: startAd } = await import("../../src/lib/startAd.js");
	await startAd();
	expect(admob.start).not.toHaveBeenCalled();
	expect(admob.BannerAd).not.toHaveBeenCalled();
});

test("Android retains its existing test units and SDK version gate", async () => {
	setBuildConstants("android", "Debug");
	window.ANDROID_SDK_INT = 28;
	const { default: startAd } = await import("../../src/lib/startAd.js");
	await startAd();
	expect(admob.start).not.toHaveBeenCalled();
	window.ANDROID_SDK_INT = 29;
	await startAd();
	expect(admob.BannerAd).toHaveBeenCalledWith({
		adUnitId: "ca-app-pub-3940256099942544/6300978111",
		position: "bottom",
	});
	expect(window.adRewardedUnitId).toBe(
		"ca-app-pub-3940256099942544/5224354917",
	);
});

test.each([
	"",
	"invalid",
	"ca-app-pub-3940256099942544/2435281174",
])("release builds reject an invalid production ID: %s", (id) => {
	const original = ads.ios.production.banner;
	ads.ios.production.banner = id;
	try {
		expect(() => getAdConfig("ios", "Release")).toThrow(
			/Invalid ios banner ID/,
		);
	} finally {
		ads.ios.production.banner = original;
	}
});

test("runtime build metadata cannot replace compiled iOS production IDs", async () => {
	setBuildConstants("ios", "Release");
	Bridge.platformId = "android";
	const { default: startAd } = await import("../../src/lib/startAd.js");
	await startAd();
	expect(admob.BannerAd).toHaveBeenCalledWith({
		adUnitId: ads.ios.production.banner,
		position: "bottom",
	});
});

test.each([
	"online",
	"resume",
])("recovers failed startup on %s and deduplicates repeated events", async (event) => {
	if (event === "online") {
		admob.privacy.gatherConsent.mockRejectedValueOnce(new Error("offline"));
		admob.privacy.getState = vi
			.fn()
			.mockResolvedValue({ consentStatus: "unknown", canRequestAds: false });
	} else {
		admob.start.mockRejectedValueOnce(new Error("ATT interrupted"));
	}
	const ads = await import("../../src/lib/startAd.js");
	await ads.default();
	expect(ads.initialized).toBe(false);
	let finishConsent;
	admob.privacy.gatherConsent.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				finishConsent = resolve;
			}),
	);
	const target = event === "online" ? window : document;
	target.dispatchEvent(new Event(event));
	target.dispatchEvent(new Event(event));
	expect(admob.privacy.gatherConsent).toHaveBeenCalledTimes(2);
	finishConsent({ consentStatus: "notRequired", canRequestAds: true });
	await vi.waitFor(() => expect(ads.initialized).toBe(true));
	expect(admob.BannerAd).toHaveBeenCalledOnce();
	expect(admob.InterstitialAd).toHaveBeenCalledOnce();
	window.dispatchEvent(new Event("online"));
	document.dispatchEvent(new Event("resume"));
	expect(admob.privacy.gatherConsent).toHaveBeenCalledTimes(2);
});

test("automatic recovery respects foreground, connectivity and Pro state", async () => {
	admob.privacy.gatherConsent.mockResolvedValueOnce({
		consentStatus: "unknown",
		canRequestAds: false,
	});
	const ads = await import("../../src/lib/startAd.js");
	await ads.default();
	document.hidden = true;
	window.dispatchEvent(new Event("online"));
	document.hidden = false;
	navigator.onLine = false;
	document.dispatchEvent(new Event("resume"));
	navigator.onLine = true;
	const config = await import("../../src/lib/config");
	config.default.HAS_PRO = true;
	document.dispatchEvent(new Event("resume"));
	expect(admob.privacy.gatherConsent).toHaveBeenCalledOnce();
	expect(admob.BannerAd).not.toHaveBeenCalled();
});

test("recovery does not reopen required consent forms but permits an explicit retry", async () => {
	admob.privacy.gatherConsent.mockResolvedValueOnce({
		consentStatus: "required",
		canRequestAds: false,
	});
	const ads = await import("../../src/lib/startAd.js");
	await ads.default();
	window.dispatchEvent(new Event("online"));
	document.dispatchEvent(new Event("resume"));
	expect(admob.privacy.gatherConsent).toHaveBeenCalledOnce();
	await ads.default();
	expect(ads.initialized).toBe(true);
	expect(admob.privacy.gatherConsent).toHaveBeenCalledTimes(2);
});

test("throttles automatic consent retries without delaying explicit user attempts", async () => {
	const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
	admob.privacy.gatherConsent.mockResolvedValue({
		consentStatus: "unknown",
		canRequestAds: false,
	});
	const ads = await import("../../src/lib/startAd.js");
	await ads.default();
	window.dispatchEvent(new Event("online"));
	for (let i = 0; i < 8; i++) await Promise.resolve();
	document.dispatchEvent(new Event("resume"));
	expect(admob.privacy.gatherConsent).toHaveBeenCalledTimes(2);
	now.mockReturnValue(31_000);
	document.dispatchEvent(new Event("resume"));
	for (let i = 0; i < 8; i++) await Promise.resolve();
	expect(admob.privacy.gatherConsent).toHaveBeenCalledTimes(3);
	await ads.default();
	expect(admob.privacy.gatherConsent).toHaveBeenCalledTimes(4);
});

function setBuildConstants(platform, mode) {
	const ids = getAdConfig(platform, mode);
	vi.stubGlobal("IS_IOS", platform === "ios");
	vi.stubGlobal("IS_ANDROID", platform === "android");
	vi.stubGlobal("PLATFORM", platform);
	vi.stubGlobal("ADMOB_BANNER_ID", ids.banner);
	vi.stubGlobal("ADMOB_INTERSTITIAL_ID", ids.interstitial);
	vi.stubGlobal("ADMOB_REWARDED_ID", ids.rewarded);
}

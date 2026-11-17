import { afterEach, expect, test, vi } from "vitest";
import showRewardedAd, {
	isRewardedAdSupported,
} from "../../src/lib/paid/rewardedAd";
import startAd, {
	getPrivacyState,
	showPrivacyOptions,
	subscribePrivacyState,
} from "../../src/lib/paid/startAd";

afterEach(() => vi.unstubAllGlobals());

test("paid APIs preserve unavailable-ad behavior without a native advertising bridge", async () => {
	vi.stubGlobal("strings", { "rewarded ad unavailable": "Reward unavailable" });
	await expect(startAd()).resolves.toBeUndefined();
	expect(isRewardedAdSupported()).toBe(false);
	await expect(showRewardedAd()).rejects.toThrow("Reward unavailable");
	const controller = new AbortController();
	controller.abort();
	await expect(showRewardedAd({ signal: controller.signal })).resolves.toBe(
		false,
	);
	await expect(showPrivacyOptions()).rejects.toThrow(
		"Privacy Choices are unavailable",
	);
	const listener = vi.fn();
	const unsubscribe = subscribePrivacyState(listener);
	expect(listener).toHaveBeenCalledWith({
		consentStatus: "unknown",
		canRequestAds: false,
		privacyOptionsRequired: false,
	});
	expect(() => unsubscribe()).not.toThrow();
	expect(() => subscribePrivacyState(null)).toThrow(TypeError);
	const state = getPrivacyState();
	state.canRequestAds = true;
	expect(getPrivacyState().canRequestAds).toBe(false);
});

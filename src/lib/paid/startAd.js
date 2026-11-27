import { EMPTY_PRIVACY_STATE } from "../adDefaults.mjs";

export { BANNER_SUPPRESSION_REASON } from "../adDefaults.mjs";
export const adUnitIdBanner = "";
export const adUnitIdInterstitial = "";
export const adUnitIdRewarded = "";
export const initialized = false;
export const bannerAd = null;
export const interstitialAd = null;

export default async function startAd() {}

export function getPrivacyState() {
	return { ...EMPTY_PRIVACY_STATE };
}

export function subscribePrivacyState(listener) {
	if (typeof listener !== "function") {
		throw new TypeError("Privacy state listener must be a function.");
	}
	listener(getPrivacyState());
	return () => {};
}

export async function showPrivacyOptions() {
	throw new Error("AdMob Privacy Choices are unavailable.");
}

export function setBannerSuppressed() {}
export function requestBannerForPage() {}
export function setBannerKeyboardVisible() {}

import {
	AdConsentCoordinator,
	EMPTY_PRIVACY_STATE,
} from "./adConsentCoordinator.mjs";
import {
	BANNER_SUPPRESSION_REASON,
	bannerVisibilityController,
} from "./bannerVisibilityController.mjs";
import config from "./config";

export { BANNER_SUPPRESSION_REASON };

export const adUnitIdBanner = ADMOB_BANNER_ID;
export const adUnitIdInterstitial = ADMOB_INTERSTITIAL_ID;
export const adUnitIdRewarded = ADMOB_REWARDED_ID;
export let initialized = false;

/** @type {import("native/admob").BannerAd} */
export let bannerAd = null;
/** @type {import("native/admob").InterstitialAd} */
export let interstitialAd = null;
let consentCoordinator = null;
let nextAutomaticRetry = 0;

export default async function startAd() {
	if (!canUseAdmob()) {
		if (
			!config.HAS_PRO &&
			typeof admob !== "undefined" &&
			IS_ANDROID &&
			window.ANDROID_SDK_INT < 29
		) {
			console.warn("AdMob not supported on this Android version, skipping ads");
		}
		return;
	}

	try {
		await getConsentCoordinator().start();
	} catch (error) {
		console.error("Failed to initialize ads:", error);
	}
}

export function getPrivacyState() {
	return consentCoordinator?.state ?? { ...EMPTY_PRIVACY_STATE };
}

/**
 * Subscribes to normalized UMP state. The current state is emitted immediately.
 * @param {(state:typeof EMPTY_PRIVACY_STATE)=>void} listener
 * @returns {()=>void}
 */
export function subscribePrivacyState(listener) {
	if (typeof listener !== "function") {
		throw new TypeError("Privacy state listener must be a function.");
	}

	if (!canUseAdmob()) {
		listener(getPrivacyState());
		return () => {};
	}

	return getConsentCoordinator().subscribe(listener);
}

export async function showPrivacyOptions() {
	if (!canUseAdmob()) {
		throw new Error("AdMob Privacy Choices are unavailable.");
	}
	return getConsentCoordinator().showPrivacyOptions();
}

function canUseAdmob() {
	return (
		!config.HAS_PRO &&
		typeof admob !== "undefined" &&
		(IS_IOS || window.ANDROID_SDK_INT >= 29)
	);
}

function getConsentCoordinator() {
	if (!consentCoordinator) {
		consentCoordinator = new AdConsentCoordinator({
			privacy: admob.privacy,
			initializeAds,
			onError: (error) =>
				console.warn("Unable to refresh AdMob consent information:", error),
		});
		document.addEventListener("resume", retryAdStartup);
		window.addEventListener("online", retryAdStartup);
	}
	return consentCoordinator;
}

function retryAdStartup() {
	if (
		initialized ||
		!canUseAdmob() ||
		document.hidden ||
		navigator.onLine === false ||
		getPrivacyState().consentStatus === "required" ||
		Date.now() < nextAutomaticRetry
	)
		return;
	nextAutomaticRetry = Date.now() + 30_000;
	void startAd();
}

async function initializeAds() {
	if (initialized) return;
	await admob.start();

	const currentHour = new Date().getHours();
	const isQuietHours = currentHour >= 22 || currentHour < 4;

	await admob.configure({
		appMuted: isQuietHours,
		appVolume: isQuietHours ? 0.0 : 1.0,
	});

	const banner = new admob.BannerAd({
		adUnitId: adUnitIdBanner,
		position: "bottom",
	});
	const interstitial = new admob.InterstitialAd({
		adUnitId: adUnitIdInterstitial,
	});

	interstitial.load().catch((error) => {
		console.warn("Failed to preload interstitial ad:", error);
	});
	interstitial.on("dismiss", () => {
		interstitial.load().catch((error) => {
			console.warn("Failed to reload interstitial ad:", error);
		});
	});

	bannerAd = banner;
	interstitialAd = interstitial;
	bannerVisibilityController.setBanner(banner);
	window.ad = banner;
	window.iad = interstitial;
	window.adRewardedUnitId = adUnitIdRewarded;
	initialized = true;
}

/**
 * Adds or removes one independent reason for hiding banner ads.
 * @param {string} reason
 * @param {boolean} suppressed
 */
export function setBannerSuppressed(reason, suppressed) {
	bannerVisibilityController.setSuppressed(reason, suppressed);
}

/**
 * Registers a page as eligible to display the shared banner.
 * @param {HTMLElement} page
 */
export function requestBannerForPage(page) {
	bannerVisibilityController.registerPage(page);
}

/**
 * Temporarily suppresses the banner while the soft keyboard is visible.
 * @param {boolean} visible
 */
export function setBannerKeyboardVisible(visible) {
	bannerVisibilityController.setKeyboardVisible(visible);
}

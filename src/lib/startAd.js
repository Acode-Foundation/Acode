import {
	AdConsentCoordinator,
	EMPTY_PRIVACY_STATE,
} from "./adConsentCoordinator.mjs";
import { bannerVisibilityController } from "./bannerVisibilityController.mjs";
import config from "./config";

export let adUnitIdBanner = "ca-app-pub-5911839694379275/9157899592"; // Production
export let adUnitIdInterstitial = "ca-app-pub-5911839694379275/9570937608"; // Production
export let adUnitIdRewarded = "ca-app-pub-5911839694379275/1633667633"; // Production
export let initialized = false;

/** @type {import("plugins/admob/src/www").BannerAd} */
export let bannerAd = null;
/** @type {import("plugins/admob/src/www").InterstitialAd} */
export let interstitialAd = null;
let consentCoordinator = null;

export default async function startAd() {
	if (!canUseAdmob()) {
		if (
			!config.HAS_PRO &&
			typeof admob !== "undefined" &&
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
	if (!canUseAdmob()) return getPrivacyState();
	return getConsentCoordinator().showPrivacyOptions();
}

function canUseAdmob() {
	return (
		!config.HAS_PRO &&
		typeof admob !== "undefined" &&
		window.ANDROID_SDK_INT >= 29
	);
}

function getConsentCoordinator() {
	consentCoordinator ??= new AdConsentCoordinator({
		privacy: admob.privacy,
		initializeAds,
		onError: (error) =>
			console.warn("Unable to refresh AdMob consent information:", error),
	});
	return consentCoordinator;
}

async function initializeAds() {
	if (initialized) return;

	if (BuildInfo.buildType === "debug") {
		console.info("!!! Using test ads");
		adUnitIdBanner = "ca-app-pub-3940256099942544/6300978111";
		adUnitIdInterstitial = "ca-app-pub-3940256099942544/1033173712";
		adUnitIdRewarded = "ca-app-pub-3940256099942544/5224354917";
	}

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
 * Hides the ad
 * @param {Boolean} [force=false]
 */
export function hideAd(force = false) {
	if (force) {
		bannerVisibilityController.suspend();
		return;
	}

	bannerVisibilityController.reconcile();
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

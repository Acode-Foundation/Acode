import config from "./config";

export let adUnitIdBanner = "ca-app-pub-5911839694379275/9157899592"; // Production
export let adUnitIdInterstitial = "ca-app-pub-5911839694379275/9570937608"; // Production
export let adUnitIdRewarded = "ca-app-pub-5911839694379275/1633667633"; // Production
export let initialized = false;

/** @type {import("plugins/admob/esm").BannerAd} */
export let bannerAd = null;
/** @type {import("plugins/admob/esm").InterstitialAd} */
export let interstitialAd = null;

export default async function startAd() {
	if (config.HAS_PRO || typeof admob === "undefined") return;

	if (window.ANDROID_SDK_INT < 29) {
		console.warn("AdMob not supported on this Android version, skipping ads");
		return;
	}

	try {
		if (!initialized) {
			initialized = true;

			if (BuildInfo.buildType === "debug") {
				console.info("!!! Using test ads");
				adUnitIdBanner = "ca-app-pub-3940256099942544/6300978111"; // Test
				adUnitIdInterstitial = "ca-app-pub-3940256099942544/1033173712"; // Test
				adUnitIdRewarded = "ca-app-pub-3940256099942544/5224354917"; // Test
			}
		}

		const consentStatus = await consent.getConsentStatus();
		if (consentStatus === consent.ConsentStatus.Required) {
			await consent.requestInfoUpdate();
		}

		const formStatus = await consent.getFormStatus();
		if (formStatus === consent.FormStatus.Available) {
			const form = await consent.loadForm();
			form.show();
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

		interstitial.load();

		interstitial.on("dismiss", () => {
			interstitial.load();
		});

		bannerAd = banner;
		interstitialAd = interstitial;
		window.ad = banner;
		window.iad = interstitial;
		window.adRewardedUnitId = adUnitIdRewarded;
	} catch (error) {
		console.error("Failed to initialize ads:", error);
		initialized = false;
	}
}

/**
 * Hides the ad
 * @param {Boolean} [force=false]
 */
export function hideAd(force = false) {
	if (!bannerAd?.active || typeof bannerAd.hide !== "function") return;

	const $pages = tag.getAll(".page-replacement");
	const hide = $pages.length === 1;

	if (force || hide) {
		bannerAd.active = false;
		bannerAd.hide();
	}
}

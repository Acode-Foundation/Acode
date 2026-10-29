import config from "./config";
import startAd, {
	adUnitIdRewarded,
	getPrivacyState,
	initialized,
} from "./startAd";

const RESULT_TIMEOUT_MS = 90_000;
let active = false;
let nextId = 0;

export function isRewardedAdSupported() {
	return Boolean(
		!config.HAS_PRO &&
			typeof admob !== "undefined" &&
			admob.RewardedAd &&
			window.ANDROID_SDK_INT >= 29 &&
			adUnitIdRewarded,
	);
}

export function isWatchingRewardedAd() {
	return active;
}

/** Show one reward, without granting an ad-free pass or applying its reward. */
export default function showRewardedAd({
	serverSideVerification,
	signal,
} = {}) {
	if (signal?.aborted) return Promise.resolve(false);
	if (active || !isRewardedAdSupported()) {
		return Promise.reject(new Error(strings["rewarded ad unavailable"]));
	}
	active = true;
	return new Promise((resolve, reject) => {
		let earned = false;
		let settled = false;
		let presenting = false;
		let cleaned = false;
		const unsubscribe = [];
		const timeout = setTimeout(
			() => finish(new Error(strings["rewarded ad failed"])),
			RESULT_TIMEOUT_MS,
		);

		function cleanup() {
			// A cancelled/timed-out caller must not allow another full-screen ad
			// until the native ad actually dismisses (show() resolves on opening).
			if (presenting || cleaned) return;
			cleaned = true;
			for (const off of unsubscribe.splice(0)) off();
			active = false;
		}

		function finish(error, result = false) {
			if (!settled) {
				settled = true;
				clearTimeout(timeout);
				signal?.removeEventListener("abort", cancel);
				if (error) reject(error);
				else resolve(result);
			}
			cleanup();
		}

		function cancel() {
			finish(null);
		}

		signal?.addEventListener("abort", cancel, { once: true });
		void (async () => {
			await startAd();
			if (settled) return;
			if (
				!isRewardedAdSupported() ||
				!initialized ||
				!getPrivacyState().canRequestAds
			) {
				throw new Error(strings["rewarded ad unavailable"]);
			}
			const ad = new admob.RewardedAd({
				id: `acode-reward-${++nextId}`,
				adUnitId: adUnitIdRewarded,
				...(serverSideVerification ? { serverSideVerification } : {}),
			});
			unsubscribe.push(
				ad.on("reward", () => {
					if (!settled) earned = true;
				}),
				ad.on("dismiss", () => {
					presenting = false;
					finish(null, earned && !signal?.aborted);
				}),
				ad.on("showfail", () => {
					presenting = false;
					finish(new Error(strings["rewarded ad failed"]));
				}),
				ad.on("loadfail", () =>
					finish(new Error(strings["rewarded ad failed"])),
				),
				() => {
					void ad.destroy().catch((error) => {
						console.warn("Failed to destroy rewarded ad", error);
					});
				},
			);
			await ad.load();
			if (settled) return;
			presenting = true;
			if ((await ad.show()) === false) {
				presenting = false;
				finish(new Error(strings["rewarded ad failed"]));
			}
		})().catch(() => {
			presenting = false;
			finish(new Error(strings["rewarded ad failed"]));
		});
	});
}

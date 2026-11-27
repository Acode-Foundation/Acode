import config from "./config";
import platform from "./platform";
import startAd, {
	adUnitIdRewarded,
	getPrivacyState,
	initialized,
} from "./startAd";

const RESULT_TIMEOUT_MS = 90_000;
const PRESENTATION_RECOVERY_MS = 10 * 60_000;
const RECOVERY_CALL_TIMEOUT_MS = 10_000;
let active = false;
let retryActivePresentation;
let nextId = 0;

export function isRewardedAdSupported() {
	return Boolean(
		!config.HAS_PRO &&
			typeof admob !== "undefined" &&
			admob.RewardedAd &&
			(platform.isIOS || window.ANDROID_SDK_INT >= 29) &&
			adUnitIdRewarded,
	);
}

/** Show one reward, without granting an ad-free pass or applying its reward. */
export default function showRewardedAd({
	serverSideVerification,
	signal,
} = {}) {
	if (signal?.aborted) return Promise.resolve(false);
	if (!isRewardedAdSupported() || (active && !retryActivePresentation)) {
		return Promise.reject(new Error(strings["rewarded ad unavailable"]));
	}
	if (active) {
		return retryActivePresentation().then(() => {
			if (signal?.aborted) return false;
			if (active) throw new Error(strings["rewarded ad unavailable"]);
			return showRewardedAd({ serverSideVerification, signal });
		});
	}
	active = true;
	return new Promise((resolve, reject) => {
		let earned = false;
		let settled = false;
		let presenting = false;
		let cleaned = false;
		const unsubscribe = [];
		let timeout;
		let recovery;
		let recoveryAttempts = 0;
		let recoveryRequest;
		let recoveryDeadline;
		let releaseRecovery;
		let loaded = false;
		let showAcknowledged = false;

		function cleanup() {
			// A cancelled/timed-out caller must not allow another full-screen ad
			// until the native ad actually dismisses (show() resolves on opening).
			if (presenting || cleaned) return;
			cleaned = true;
			clearTimeout(recovery);
			clearTimeout(recoveryDeadline);
			releaseRecovery?.();
			retryActivePresentation = undefined;
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
				finish(new Error(strings["rewarded ad unavailable"]));
				return;
			}
			timeout = setTimeout(
				() =>
					finish(
						new Error(
							strings[
								loaded ? "rewarded ad failed" : "rewarded ad unavailable"
							],
						),
					),
				RESULT_TIMEOUT_MS,
			);
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
				ad.on("loadfail", (error) => {
					console.warn(
						"Rewarded ad could not load",
						error?.code,
						error?.message,
					);
					finish(new Error(strings["rewarded ad unavailable"]));
				}),
				() => {
					void ad.destroy().catch((error) => {
						console.warn("Failed to destroy rewarded ad", error);
					});
				},
			);
			await ad.load();
			if (settled) return;
			loaded = true;
			presenting = true;
			retryActivePresentation = () => {
				if (!showAcknowledged && recoveryAttempts === 0)
					return Promise.resolve();
				if (!recoveryRequest) recoveryAttempts = 0;
				return recoverPresentation();
			};
			document.addEventListener("resume", resumeRecovery);
			unsubscribe.push(() =>
				document.removeEventListener("resume", resumeRecovery),
			);
			recovery = setTimeout(recoverPresentation, PRESENTATION_RECOVERY_MS);
			const shown = await ad.show();
			showAcknowledged = true;
			clearTimeout(timeout);
			if (shown === false) {
				presenting = false;
				finish(new Error(strings["rewarded ad failed"]));
			}

			function resumeRecovery() {
				if (recoveryAttempts < 3 || recoveryRequest || !presenting || cleaned)
					return;
				recoveryAttempts = 0;
				void recoverPresentation();
			}

			function recoverPresentation() {
				if (!presenting || cleaned) return Promise.resolve();
				if (recoveryRequest) return recoveryRequest;
				clearTimeout(recovery);
				recoveryAttempts += 1;
				const deadline = new Promise((resolve) => {
					releaseRecovery = () => resolve(false);
					recoveryDeadline = setTimeout(
						releaseRecovery,
						RECOVERY_CALL_TIMEOUT_MS,
					);
				});
				recoveryRequest = Promise.race([
					Promise.resolve().then(() => ad.recoverPresentation()),
					deadline,
				])
					.then((recovered) => {
						if (!presenting || cleaned || !recovered) return;
						presenting = false;
						finish(
							earned ? null : new Error(strings["rewarded ad failed"]),
							earned && !signal?.aborted,
						);
					})
					.catch(() => {
						// A failed or timed-out check cannot prove dismissal.
					})
					.finally(() => {
						clearTimeout(recoveryDeadline);
						releaseRecovery = undefined;
						recoveryRequest = undefined;
						if (presenting && !cleaned && recoveryAttempts < 3) {
							recovery = setTimeout(recoverPresentation, 60_000);
						}
					});
				return recoveryRequest;
			}
		})().catch((error) => {
			if (!settled) console.warn("Rewarded ad request failed", error);
			presenting = false;
			finish(
				new Error(
					strings[loaded ? "rewarded ad failed" : "rewarded ad unavailable"],
				),
			);
		});
	});
}

import toast from "components/toast";
import auth from "./auth";
import secureAdRewardState from "./secureAdRewardState";

const ONE_HOUR = 60 * 60 * 1000;
const MAX_TIMEOUT = 2_147_483_647;
const REWARDED_RESULT_TIMEOUT_MS = 90 * 1000;

const OFFERS = [
	{
		id: "quick",
		title: "Quick pass",
		description: "Watch 1 rewarded ad and pause ads for 1 hour.",
		adsRequired: 1,
		durationMs: ONE_HOUR,
		accentClass: "is-quick",
	},
	{
		id: "focus",
		title: "Focus block",
		description:
			"Watch 2 rewarded ads and pause ads for a random 4, 5, or 6 hours.",
		adsRequired: 2,
		minDurationMs: 4 * ONE_HOUR,
		maxDurationMs: 6 * ONE_HOUR,
		accentClass: "is-focus",
	},
];

let state = getDefaultState();
let expiryTimer = null;
let activeWatchPromise = null;
const listeners = new Set();

function getDefaultState() {
	return {
		adFreeUntil: 0,
		lastExpiredRewardUntil: 0,
		isActive: false,
		remainingMs: 0,
		redemptionsToday: 0,
		remainingRedemptions: 3,
		maxRedemptionsPerDay: 3,
		maxActivePassMs: 10 * ONE_HOUR,
		hasPendingExpiryNotice: false,
		expiryNoticePendingUntil: 0,
		canRedeem: true,
		redeemDisabledReason: "",
	};
}

function formatDuration(durationMs) {
	const totalHours = Math.round(durationMs / ONE_HOUR);
	if (totalHours < 1) return "less than 1 hour";
	if (totalHours === 1) return "1 hour";
	return `${totalHours} hours`;
}

function formatDurationRange(minDurationMs, maxDurationMs) {
	if (!minDurationMs || !maxDurationMs || minDurationMs === maxDurationMs) {
		return formatDuration(minDurationMs || maxDurationMs || 0);
	}

	const minHours = Math.round(minDurationMs / ONE_HOUR);
	const maxHours = Math.round(maxDurationMs / ONE_HOUR);
	return `${minHours}-${maxHours} hours`;
}

function getRewardedUnitId() {
	return window.adRewardedUnitId || "";
}

function getExpiryDate() {
	return state.adFreeUntil ? new Date(state.adFreeUntil) : null;
}

function emitChange() {
	const snapshot = {
		...state,
		expiryDate: getExpiryDate(),
	};
	listeners.forEach((listener) => {
		try {
			listener(snapshot);
		} catch (error) {
			console.error("Reward state listener failed.", error);
		}
	});
}

function hideActiveBanner() {
	if (window.ad?.active) {
		window.ad.active = false;
		window.ad.hide?.();
	}
}

function notify(title, message, type = "info") {
	toast(message, 4000);
	window.acode?.pushNotification?.(title, message, {
		icon: type === "success" ? "verified" : "notifications",
		type,
	});
}

function normalizeStatus(status) {
	const fallback = getDefaultState();
	if (!status || typeof status !== "object") return fallback;

	const adFreeUntil = Number(status.adFreeUntil) || 0;
	const remainingMs = Math.max(0, Number(status.remainingMs) || 0);

	return {
		...fallback,
		...status,
		adFreeUntil,
		lastExpiredRewardUntil: Number(status.lastExpiredRewardUntil) || 0,
		remainingMs,
		redemptionsToday: Number(status.redemptionsToday) || 0,
		remainingRedemptions: Number(status.remainingRedemptions) || 0,
		maxRedemptionsPerDay:
			Number(status.maxRedemptionsPerDay) || fallback.maxRedemptionsPerDay,
		maxActivePassMs: Number(status.maxActivePassMs) || fallback.maxActivePassMs,
		expiryNoticePendingUntil: Number(status.expiryNoticePendingUntil) || 0,
		isActive: Boolean(status.isActive && adFreeUntil > Date.now()),
		hasPendingExpiryNotice: Boolean(status.hasPendingExpiryNotice),
		canRedeem: Boolean(status.canRedeem),
		redeemDisabledReason: String(status.redeemDisabledReason || ""),
	};
}

function clearExpiryTimer() {
	if (expiryTimer) {
		clearTimeout(expiryTimer);
		expiryTimer = null;
	}
}

async function refreshState({ notifyExpiry = false } = {}) {
	try {
		const nextState = normalizeStatus(await secureAdRewardState.getStatus());
		state = nextState;
		emitChange();
		scheduleExpiryCheck();

		if (notifyExpiry && nextState.hasPendingExpiryNotice) {
			notify(
				"Ad-free pass ended",
				"Your rewarded ad-free time has expired. You can watch another rewarded ad anytime.",
				"warning",
			);
		}

		return nextState;
	} catch (error) {
		console.warn("Failed to refresh rewarded ad state.", error);
		return state;
	}
}

function scheduleExpiryCheck() {
	clearExpiryTimer();
	if (!state.adFreeUntil) return;

	const remainingMs = state.adFreeUntil - Date.now();
	if (remainingMs <= 0) {
		void refreshState({ notifyExpiry: true });
		return;
	}

	expiryTimer = setTimeout(
		() => {
			void refreshState({ notifyExpiry: true });
		},
		Math.min(remainingMs, MAX_TIMEOUT),
	);
}

async function getRewardIdentity() {
	try {
		const user = await auth.getUserInfo();
		const userId =
			user?.id ||
			user?._id ||
			user?.github ||
			user?.username ||
			device?.uuid ||
			"guest";
		return String(userId);
	} catch (error) {
		console.warn("Failed to resolve rewarded ad user identity.", error);
		return String(device?.uuid || "guest");
	}
}

async function createRewardedAd(offer, step, sessionId) {
	const rewardedUnitId = getRewardedUnitId();
	if (!rewardedUnitId || !admob?.RewardedAd) {
		throw new Error("Rewarded ads are not available in this build.");
	}

	const userId = await getRewardIdentity();
	const customData = [
		`session=${sessionId}`,
		`offer=${offer.id}`,
		`step=${step}`,
		`ads=${offer.adsRequired}`,
	].join("&");

	return new admob.RewardedAd({
		adUnitId: rewardedUnitId,
		serverSideVerification: {
			userId,
			customData,
		},
	});
}

function waitForRewardedResult(ad) {
	return new Promise((resolve, reject) => {
		let earned = false;
		let settled = false;
		const timeoutId = setTimeout(() => {
			fail(
				new Error("Rewarded ad timed out before completion. Please try again."),
			);
		}, REWARDED_RESULT_TIMEOUT_MS);

		const finish = (result) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeoutId);
			resolve(result);
		};

		const fail = (error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeoutId);
			reject(
				error instanceof Error
					? error
					: new Error(error?.message || "Rewarded ad failed."),
			);
		};

		ad.on("reward", () => {
			earned = true;
		});

		ad.on("dismiss", () => {
			finish({ earned });
		});

		ad.on("showfail", fail);
		ad.on("loadfail", fail);
	});
}

async function showRewardedStep(offer, step, sessionId) {
	const rewardedAd = await createRewardedAd(offer, step, sessionId);
	const resultPromise = waitForRewardedResult(rewardedAd);
	await rewardedAd.load();
	await rewardedAd.show();
	const result = await resultPromise;
	if (!result.earned) {
		throw new Error("Reward not earned. The ad was closed before completion.");
	}
}

export default {
	async init() {
		await refreshState({ notifyExpiry: false });
	},
	onChange(listener) {
		listeners.add(listener);
		return () => listeners.delete(listener);
	},
	async handleResume() {
		await refreshState({ notifyExpiry: true });
	},
	getState() {
		return {
			...state,
			expiryDate: getExpiryDate(),
		};
	},
	getOffers() {
		return OFFERS.map((offer) => ({
			...offer,
			durationLabel: formatDurationRange(
				offer.minDurationMs || offer.durationMs,
				offer.maxDurationMs || offer.durationMs,
			),
		}));
	},
	getRemainingMs() {
		return Math.max(0, state.remainingMs || state.adFreeUntil - Date.now());
	},
	getRemainingLabel() {
		const remainingMs = this.getRemainingMs();
		if (!remainingMs) return "No active ad-free pass";

		const minutes = Math.ceil(remainingMs / (60 * 1000));
		if (minutes < 60) {
			return `${minutes} minute${minutes === 1 ? "" : "s"} remaining`;
		}

		const hours = Math.floor(minutes / 60);
		const remMinutes = minutes % 60;
		if (!remMinutes) {
			return `${hours} hour${hours === 1 ? "" : "s"} remaining`;
		}

		return `${hours}h ${remMinutes}m remaining`;
	},
	getExpiryLabel() {
		const expiryDate = getExpiryDate();
		if (!expiryDate) return "No active pass";
		return expiryDate.toLocaleString();
	},
	isAdFreeActive() {
		return Boolean(state.isActive && state.adFreeUntil > Date.now());
	},
	canShowAds() {
		return Boolean(window.IS_FREE_VERSION && !this.isAdFreeActive());
	},
	isRewardedSupported() {
		return Boolean(
			window.IS_FREE_VERSION && admob?.RewardedAd && getRewardedUnitId(),
		);
	},
	getRewardedUnavailableReason() {
		if (!window.IS_FREE_VERSION)
			return "Ads are already disabled on this build.";
		if (!admob?.RewardedAd)
			return "Rewarded ads are unavailable on this device.";
		if (!getRewardedUnitId()) {
			return "Rewarded ads are not configured for production yet.";
		}
		return "";
	},
	canRedeemNow() {
		return {
			ok: Boolean(state.canRedeem),
			reason: state.redeemDisabledReason || "",
		};
	},
	isWatchingReward() {
		return Boolean(activeWatchPromise);
	},
	async watchOffer(offerId, { onStep } = {}) {
		if (activeWatchPromise) {
			return activeWatchPromise;
		}

		const offer = OFFERS.find((item) => item.id === offerId);
		if (!offer) {
			throw new Error("Reward offer not found.");
		}
		if (!this.isRewardedSupported()) {
			throw new Error(this.getRewardedUnavailableReason());
		}

		await refreshState({ notifyExpiry: false });
		const redemptionStatus = this.canRedeemNow();
		if (!redemptionStatus.ok) {
			throw new Error(redemptionStatus.reason);
		}

		const sessionId =
			typeof crypto?.randomUUID === "function"
				? crypto.randomUUID()
				: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

		activeWatchPromise = (async () => {
			for (let step = 1; step <= offer.adsRequired; step += 1) {
				onStep?.({
					step,
					totalSteps: offer.adsRequired,
					offer,
				});
				await showRewardedStep(offer, step, sessionId);

				if (step < offer.adsRequired) {
					toast(
						`Reward ${step}/${offer.adsRequired} complete. Loading the next ad...`,
						2500,
					);
				}
			}

			const redeemedState = normalizeStatus(
				await secureAdRewardState.redeem(offer.id),
			);
			const grantedDurationMs =
				Number(redeemedState.appliedDurationMs) ||
				Number(redeemedState.grantedDurationMs) ||
				0;

			state = redeemedState;
			emitChange();
			hideActiveBanner();
			scheduleExpiryCheck();

			notify(
				"Ad-free pass started",
				`${formatDuration(grantedDurationMs)} unlocked. Ads will stay hidden until ${new Date(redeemedState.adFreeUntil).toLocaleString()}.`,
				"success",
			);

			return {
				offer,
				expiresAt: redeemedState.adFreeUntil,
				grantedDurationMs,
			};
		})().finally(() => {
			activeWatchPromise = null;
			emitChange();
		});

		emitChange();
		return activeWatchPromise;
	},
};

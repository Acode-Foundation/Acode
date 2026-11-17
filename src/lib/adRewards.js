import toast from "components/toast";
import {
	createRewardStateLifecycle,
	isRewardPassActive,
} from "./adRewardBannerPolicy.mjs";
import config from "./config";
import secureAdRewardState from "./secureAdRewardState";
import { setBannerSuppressed } from "./startAd";

let state = normalizeStatus();

const rewardLifecycle = createRewardStateLifecycle({
	loadStatus: () => secureAdRewardState.getStatus(),
	normalizeStatus,
	getCurrentState: () => state,
	setCurrentState: (nextState) => {
		state = nextState;
	},
	setBannerSuppressed,
	onRefreshError: (error) =>
		console.warn("Failed to refresh rewarded ad state.", error),
	onListenerError: (error) =>
		console.error("Reward lifecycle listener failed.", error),
	onExpiryNotice: () => {
		notify(
			"Ad-free pass ended",
			"Your rewarded ad-free time has expired. Ads will now resume.",
			"warning",
		);
	},
});

export default {
	async init() {
		await rewardLifecycle.initialize();
	},
	async handleResume() {
		await rewardLifecycle.resume();
	},
	isAdFreeActive() {
		return isRewardPassActive(state);
	},
	canShowAds() {
		return Boolean(!config.HAS_PRO && !this.isAdFreeActive());
	},
};

function normalizeStatus(status) {
	const adFreeUntil = Number(status?.adFreeUntil) || 0;
	return {
		adFreeUntil,
		isActive: Boolean(status?.isActive && adFreeUntil > Date.now()),
		hasPendingExpiryNotice: Boolean(status?.hasPendingExpiryNotice),
	};
}

function notify(title, message, type = "info") {
	toast(message, 4000);
	window.acode?.pushNotification?.(title, message, {
		icon: type === "success" ? "verified" : "notifications",
		type,
	});
}

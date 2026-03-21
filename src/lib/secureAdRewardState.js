function execSystem(action, args = []) {
	return new Promise((resolve, reject) => {
		if (!window.cordova?.exec) {
			reject(new Error("Cordova exec is unavailable."));
			return;
		}

		cordova.exec(resolve, reject, "System", action, args);
	});
}

export default {
	async getStatus() {
		try {
			const raw = await execSystem("getRewardStatus");
			if (!raw) return null;
			return typeof raw === "string" ? JSON.parse(raw) : raw;
		} catch (error) {
			console.warn("Failed to load secure rewarded ad status.", error);
			return null;
		}
	},
	async redeem(offerId) {
		try {
			const raw = await execSystem("redeemReward", [offerId]);
			if (!raw) return null;
			return typeof raw === "string" ? JSON.parse(raw) : raw;
		} catch (error) {
			console.warn("Failed to redeem rewarded ad offer.", error);
			throw error;
		}
	},
};

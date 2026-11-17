function execSystem(action, args = []) {
	return new Promise((resolve, reject) => {
		if (!window.Bridge?.exec) {
			reject(new Error("Native exec is unavailable."));
			return;
		}

		Bridge.exec(resolve, reject, "System", action, args);
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
};

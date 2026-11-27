export function isRewardedAdSupported() {
	return false;
}

export default function showRewardedAd({ signal } = {}) {
	if (signal?.aborted) return Promise.resolve(false);
	return Promise.reject(new Error(strings["rewarded ad unavailable"]));
}

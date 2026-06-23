let adRewards;
let adRewardsPromise;
let startAdModule;
let startAdModulePromise;

export function getLoadedAdRewards() {
	return adRewards;
}

export function loadAdRewards() {
	adRewardsPromise ??= import("lib/adRewards").then((module) => {
		adRewards = module.default;
		return adRewards;
	});
	return adRewardsPromise;
}

export function getLoadedStartAdModule() {
	return startAdModule;
}

export function loadStartAdModule() {
	startAdModulePromise ??= import("lib/startAd").then((module) => {
		startAdModule = module;
		return startAdModule;
	});
	return startAdModulePromise;
}

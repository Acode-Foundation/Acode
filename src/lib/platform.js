const isIOS = globalThis.Bridge?.platformId === "ios";

export default Object.freeze({
	isIOS,
	localExecution: true,
	androidStorageAccess: !isIOS,
	androidIntents: !isIOS,
	appExit: !isIOS,
	apkUpdates: !isIOS,
	// The account backend does not yet verify App Store plugin orders.
	pluginPurchases: !isIOS,
});

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const networks = require("../ios/skadnetwork.json");
const { getAdConfig } = require("../config");
const root = path.resolve(__dirname, "../..");

module.exports = { prepareAds };

function prepareAds(mode) {
	const { appId } = getAdConfig("ios", mode);
	const file = path.join(root, ".ios-build/App-Info.plist");
	fs.mkdirSync(path.dirname(file), { recursive: true });
	execFileSync("plutil", [
		"-convert",
		"xml1",
		"-o",
		file,
		path.join(root, "platforms/ios/runner/Info.plist"),
	]);
	for (const [key, value] of Object.entries({
		GADApplicationIdentifier: appId,
		GADDelayAppMeasurementInit: true,
		NSUserTrackingUsageDescription:
			"Your permission helps show relevant ads that support the free version of Acode.",
		SKAdNetworkItems: networks.map((id) => ({ SKAdNetworkIdentifier: id })),
	})) {
		execFileSync("plutil", [
			"-insert",
			key,
			"-json",
			JSON.stringify(value),
			file,
		]);
	}
}

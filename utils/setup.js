// setup acode for the first time
// 1. install dependencies
// 2. add cordova platform android@10.2
// 3. install cordova plugins
// cordova-plugin-buildinfo
// cordova-plugin-device
// cordova-plugin-file
// all the plugins in ./src/plugins

const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const PLATFORM_FILES = [".DS_Store"];

execSync("npm install", { stdio: "inherit" });
try {
	execSync("cordova platform add android", { stdio: "inherit" });
} catch (error) {
	// ignore
}

try {
	execSync("mkdir -p www/css/build www/js/build", { stdio: "inherit" });
} catch (error) {
	console.log(
		"Failed to create www/css/build & www/js/build directories (You may Try after reading The Error)",
		error,
	);
}

execSync("cordova plugin add cordova-plugin-buildinfo", { stdio: "inherit" });
execSync("cordova plugin add cordova-plugin-device", { stdio: "inherit" });
execSync("cordova plugin add cordova-plugin-file", { stdio: "inherit" });

const plugins = fs.readdirSync(path.join(__dirname, "../src/plugins"));
for (const plugin of plugins) {
	if (PLATFORM_FILES.includes(plugin) || plugin.startsWith(".")) continue;
	execSync(`cordova plugin add ./src/plugins/${plugin}`, { stdio: "inherit" });
}

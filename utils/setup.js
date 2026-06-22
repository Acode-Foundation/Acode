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
const PACKAGE_MANAGERS = new Set(["bun", "npm", "pnpm", "yarn"]);
const ID_PAID = "com.foxdebug.acode";
const ADMOB_PLUGIN_DIR = "admob";

function isPaidVersion() {
	const configPath = path.join(__dirname, "../config.xml");
	let config;

	try {
		config = fs.readFileSync(configPath, "utf8");
	} catch (error) {
		throw new Error(`Unable to read config.xml at ${configPath}.`, {
			cause: error,
		});
	}

	const widgetId = /<widget[^>]*?\sid=["']([^"']+)["']/.exec(config)?.[1];

	return widgetId === ID_PAID;
}

function getPackageManager() {
	const userAgent = process.env.npm_config_user_agent;
	const packageManager = userAgent?.split("/")[0];

	if (PACKAGE_MANAGERS.has(packageManager)) {
		return packageManager;
	}

	return "npm";
}

function installDependencies() {
	const packageManager = getPackageManager();

	try {
		execSync(`${packageManager} install`, { stdio: "inherit" });
	} catch (error) {
		if (packageManager === "npm") {
			throw error;
		}

		console.warn(
			`Failed to install dependencies with ${packageManager}. Falling back to npm.`,
		);
		execSync("npm install", { stdio: "inherit" });
	}
}

installDependencies();
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

const shouldSkipAdmob = isPaidVersion();
const plugins = fs.readdirSync(path.join(__dirname, "../src/plugins"));
plugins.forEach((plugin) => {
	if (PLATFORM_FILES.includes(plugin) || plugin.startsWith(".")) return;
	const pluginPath = path.join(__dirname, "../src/plugins", plugin);
	if (!fs.lstatSync(pluginPath).isDirectory()) return;
	if (shouldSkipAdmob && plugin === ADMOB_PLUGIN_DIR) return;
	execSync(`cordova plugin add ./src/plugins/${plugin}`, { stdio: "inherit" });
});

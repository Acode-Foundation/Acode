// setup acode for the first time
// 1. verify git submodules are checked out
// 2. install dependencies
// 3. add cordova platform android@10.2
// 4. install cordova plugins
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
const REPO_ROOT = path.join(__dirname, "..");

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

// Parse every submodule declared in .gitmodules. Plain string parsing (instead
// of shelling out to `git submodule status`) so setup also works when git is
// not installed, e.g. inside a CI container or an unpacked source archive.
function parseGitmodules(content) {
	const submodules = [];
	let current = null;

	for (const rawLine of content.split(/\r?\n/)) {
		const line = rawLine.trim();

		if (!line || line.startsWith("#") || line.startsWith(";")) continue;

		const section = /^\[submodule\s+"(.*)"\]$/.exec(line);
		if (section) {
			current = { name: section[1], path: "", url: "" };
			submodules.push(current);
			continue;
		}

		const entry = /^([^=]+?)\s*=\s*(.*)$/.exec(line);
		if (!current || !entry) continue;

		const key = entry[1].trim();
		if (key === "path") current.path = entry[2].trim();
		else if (key === "url") current.url = entry[2].trim();
	}

	return submodules.filter((submodule) => submodule.path);
}

// An uninitialized submodule leaves its directory empty (or absent), and a
// partial checkout may hold only `.git` or `node_modules`. Require at least one
// non-hidden regular file so those are rejected before dependencies are
// installed, without hardcoding a file name for every submodule.
function hasSubmoduleSources(repoRoot, submodule) {
	const submodulePath = path.join(repoRoot, submodule.path);

	let entries;
	try {
		entries = fs.readdirSync(submodulePath, { withFileTypes: true });
	} catch (error) {
		if (error.code === "ENOENT") return false;
		throw error;
	}

	return entries.some((entry) => entry.isFile() && !entry.name.startsWith("."));
}

function findMissingSubmodules(repoRoot = REPO_ROOT) {
	const gitmodulesPath = path.join(repoRoot, ".gitmodules");

	if (!fs.existsSync(gitmodulesPath)) return [];

	const submodules = parseGitmodules(fs.readFileSync(gitmodulesPath, "utf8"));

	return submodules.filter(
		(submodule) => !hasSubmoduleSources(repoRoot, submodule),
	);
}

function failMissingSubmodules(missing) {
	const list = missing
		.map((submodule) =>
			submodule.url
				? `  - ${submodule.path}\n      ${submodule.url}`
				: `  - ${submodule.path}`,
		)
		.join("\n");

	console.error(`
The following submodule(s) are not checked out (empty or absent):

${list}


How to fix:
  From the repository root, run:

      git submodule update --init --recursive

  Then re-run setup:

      npm run setup
`);

	process.exit(1);
}

function verifySubmodules(repoRoot = REPO_ROOT) {
	const missing = findMissingSubmodules(repoRoot);

	if (missing.length > 0) failMissingSubmodules(missing);
}

function main() {
	verifySubmodules();
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
		execSync(`cordova plugin add ./src/plugins/${plugin}`, {
			stdio: "inherit",
		});
	});
}

if (require.main === module) {
	main();
}

//used in tests
module.exports = {
	parseGitmodules,
	hasSubmoduleSources,
	findMissingSubmodules,
};

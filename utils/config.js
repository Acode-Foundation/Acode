const fs = require("node:fs");
const path = require("node:path");
const { execFile: execFileCallback } = require("node:child_process");
const { promisify } = require("node:util");

const execFile = promisify(execFileCallback);

const ADMOB_PLUGIN_ID = "admob-plus-cordova";
const LEGACY_CONSENT_PLUGIN_ID = "cordova-plugin-consent";
const ID_PAID = "com.foxdebug.acode";
const ID_FREE = "com.foxdebug.acodefree";
const VARIANTS = new Set(["free", "paid"]);
const VARIANT_PLUGIN_IDS = [ADMOB_PLUGIN_ID, LEGACY_CONSENT_PLUGIN_ID];
const PACKAGE_DEPENDENCY_SECTIONS = [
	"dependencies",
	"devDependencies",
	"optionalDependencies",
];
const PLUGIN_COMMAND_ENV = Object.freeze({
	NPM_CONFIG_LEGACY_PEER_DEPS: "true",
});

const LOGO_TEXT = {
	paid: `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#3a3e54</color>
    <color name="ic_splash_background">#3a3e54</color>
</resources>`,
	free: `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#ffffff</color>
    <color name="ic_splash_background">#313131</color>
</resources>`,
};

/**
 * Returns the Cordova operations required to converge the AdMob plugin state.
 * Free builds always reinstall the vendored plugin so native and web sources
 * cannot remain stale after a source change.
 *
 * @param {{
 *   variant:"free"|"paid",
 *   bundleExists:boolean,
 *   admobState?:PluginState,
 *   legacyConsentState?:PluginState
 * }} state
 */
function getAdmobSyncPlan({
	variant,
	bundleExists,
	admobState = {},
	legacyConsentState = {},
}) {
	if (!VARIANTS.has(variant)) {
		throw new Error(`Unsupported app variant: ${variant}`);
	}

	if (variant === "free" && !bundleExists) {
		throw new Error(
			"Missing src/plugins/admob/www/admob.js. Run `npm run build:admob` before building the free app.",
		);
	}

	const actions = [];
	addRemoval(LEGACY_CONSENT_PLUGIN_ID, legacyConsentState);
	addRemoval(ADMOB_PLUGIN_ID, admobState);

	if (variant === "free") {
		actions.push({
			command: "cordova",
			args: ["plugin", "add", "src/plugins/admob", "--nosave"],
			env: PLUGIN_COMMAND_ENV,
		});
	}

	return actions;

	/**
	 * @param {string} pluginId
	 * @param {Partial<PluginState>} state
	 */
	function addRemoval(pluginId, state) {
		const { installed = false, dependencyDeclared = false } = state;

		if (installed) {
			actions.push({
				command: "cordova",
				args: [
					"plugin",
					"remove",
					pluginId,
					dependencyDeclared ? "--save" : "--nosave",
				],
				env: PLUGIN_COMMAND_ENV,
			});
			return;
		}

		if (!dependencyDeclared) return;

		actions.push({
			command: "npm",
			args: [
				"uninstall",
				pluginId,
				"--save",
				"--ignore-scripts",
				"--no-audit",
				"--no-fund",
			],
			env: PLUGIN_COMMAND_ENV,
		});
	}
}

/**
 * @typedef {{
 *   installed:boolean,
 *   dependencyDeclared:boolean,
 *   cordovaPackageDeclared:boolean,
 *   configDeclared:boolean
 * }} PluginState
 */

function readPackageJson(packagePath, fsImpl) {
	if (!fsImpl.existsSync(packagePath)) return {};
	return JSON.parse(fsImpl.readFileSync(packagePath, "utf8"));
}

function getConfigPluginPattern(pluginId, flags = "i") {
	const escapedId = pluginId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(`<plugin\\b(?=[^>]*\\bname=["']${escapedId}["'])`, flags);
}

/**
 * @param {{
 *   pluginId:string,
 *   pluginPath:string,
 *   packageJson:Record<string, unknown>,
 *   config:string,
 *   fsImpl:typeof fs
 * }} options
 * @returns {PluginState}
 */
function getPluginState({ pluginId, pluginPath, packageJson, config, fsImpl }) {
	return {
		installed: fsImpl.existsSync(pluginPath),
		dependencyDeclared: PACKAGE_DEPENDENCY_SECTIONS.some((sectionName) => {
			const section = packageJson[sectionName];
			return (
				section &&
				typeof section === "object" &&
				Object.hasOwn(section, pluginId)
			);
		}),
		cordovaPackageDeclared: Boolean(
			packageJson.cordova?.plugins &&
				Object.hasOwn(packageJson.cordova.plugins, pluginId),
		),
		configDeclared: getConfigPluginPattern(pluginId).test(config),
	};
}

function removeCordovaPluginDeclarations({ configPath, packagePath, fsImpl }) {
	const packageJson = readPackageJson(packagePath, fsImpl);
	let packageChanged = false;
	const cordovaPlugins = packageJson.cordova?.plugins;

	if (cordovaPlugins && typeof cordovaPlugins === "object") {
		for (const pluginId of VARIANT_PLUGIN_IDS) {
			if (!Object.hasOwn(cordovaPlugins, pluginId)) continue;
			delete cordovaPlugins[pluginId];
			packageChanged = true;
		}
	}

	if (packageChanged) {
		fsImpl.writeFileSync(
			packagePath,
			`${JSON.stringify(packageJson, undefined, 2)}\n`,
			"utf8",
		);
	}

	const config = fsImpl.readFileSync(configPath, "utf8");
	let nextConfig = config;
	for (const pluginId of VARIANT_PLUGIN_IDS) {
		const pluginPattern = new RegExp(
			`\\s*${getConfigPluginPattern(pluginId).source}[^>]*(?:\\/\\s*>|>[\\s\\S]*?<\\/plugin\\s*>)`,
			"gi",
		);
		nextConfig = nextConfig.replace(pluginPattern, "");
	}

	if (nextConfig !== config) {
		fsImpl.writeFileSync(configPath, nextConfig, "utf8");
	}
}

function assertPluginState({ variant, paths, fsImpl }) {
	const config = fsImpl.readFileSync(paths.config, "utf8");
	const packageJson = readPackageJson(paths.package, fsImpl);
	const admobState = getPluginState({
		pluginId: ADMOB_PLUGIN_ID,
		pluginPath: paths.admobPlugin,
		packageJson,
		config,
		fsImpl,
	});
	const legacyConsentState = getPluginState({
		pluginId: LEGACY_CONSENT_PLUGIN_ID,
		pluginPath: paths.legacyConsentPlugin,
		packageJson,
		config,
		fsImpl,
	});
	const expectedAdmobInstalled = variant === "free";

	if (Object.values(legacyConsentState).some(Boolean)) {
		throw new Error("Failed to remove the legacy Cordova consent plugin.");
	}
	if (
		admobState.dependencyDeclared ||
		admobState.cordovaPackageDeclared ||
		admobState.configDeclared
	) {
		throw new Error(
			"AdMob must not remain persisted in Cordova project metadata.",
		);
	}
	if (admobState.installed !== expectedAdmobInstalled) {
		throw new Error(
			expectedAdmobInstalled
				? "Failed to install the vendored AdMob plugin."
				: "Failed to remove the AdMob plugin from the paid variant.",
		);
	}
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {{cwd:string}} options
 */
async function runCommand(command, args, options) {
	const { stdout, stderr } = await execFile(command, args, {
		...options,
		maxBuffer: 10 * 1024 * 1024,
	});
	if (stdout) process.stdout.write(stdout);
	if (stderr) process.stderr.write(stderr);
}

/**
 * @param {{
 *   mode?:string,
 *   variant?:"free"|"paid",
 *   rootDir?:string,
 *   fsImpl?:typeof fs,
 *   commandRunner?:(command:string,args:string[],options:{
 *     cwd:string,
 *     env?:NodeJS.ProcessEnv
 *   })=>Promise<void>
 * }} options
 */
async function configureProject({
	mode = "d",
	variant = "paid",
	rootDir = path.resolve(__dirname, ".."),
	fsImpl = fs,
	commandRunner = runCommand,
} = {}) {
	if (!VARIANTS.has(variant)) {
		throw new Error(`Unsupported app variant: ${variant}`);
	}

	const paths = {
		babel: path.join(rootDir, ".babelrc"),
		bundle: path.join(rootDir, "src/plugins/admob/www/admob.js"),
		config: path.join(rootDir, "config.xml"),
		logo: path.join(rootDir, "res/android/values/ic_launcher_background.xml"),
		package: path.join(rootDir, "package.json"),
		platforms: path.join(rootDir, "platforms"),
		admobPlugin: path.join(rootDir, "plugins", ADMOB_PLUGIN_ID),
		legacyConsentPlugin: path.join(
			rootDir,
			"plugins",
			LEGACY_CONSENT_PLUGIN_ID,
		),
	};

	const config = fsImpl.readFileSync(paths.config, "utf8");
	const packageJson = readPackageJson(paths.package, fsImpl);
	const currentId = /<widget[^>]*?\sid=["']([^"']+)["']/.exec(config)?.[1];
	if (!currentId) {
		throw new Error(`Unable to read the widget id from ${paths.config}.`);
	}

	const targetId = variant === "free" ? ID_FREE : ID_PAID;
	const identityChanged = currentId !== targetId;
	const actions = getAdmobSyncPlan({
		variant,
		bundleExists: fsImpl.existsSync(paths.bundle),
		admobState: getPluginState({
			pluginId: ADMOB_PLUGIN_ID,
			pluginPath: paths.admobPlugin,
			packageJson,
			config,
			fsImpl,
		}),
		legacyConsentState: getPluginState({
			pluginId: LEGACY_CONSENT_PLUGIN_ID,
			pluginPath: paths.legacyConsentPlugin,
			packageJson,
			config,
			fsImpl,
		}),
	});

	const babelConfig = JSON.parse(fsImpl.readFileSync(paths.babel, "utf8"));
	const compact = mode === "p" || mode === "prod";
	if (babelConfig.compact !== compact) {
		babelConfig.compact = compact;
		fsImpl.writeFileSync(
			paths.babel,
			`${JSON.stringify(babelConfig, undefined, 2)}\n`,
			"utf8",
		);
	}

	if (identityChanged) {
		fsImpl.writeFileSync(
			paths.config,
			config.replace(/(<widget[^>]*?\sid=["'])[^"']+(["'])/, `$1${targetId}$2`),
			"utf8",
		);
	}

	fsImpl.writeFileSync(paths.logo, LOGO_TEXT[variant], "utf8");

	for (const action of actions) {
		console.log(`|--- ${action.command} ${action.args.join(" ")} ---|`);
		const commandOptions = { cwd: rootDir };
		if (action.env) {
			commandOptions.env = { ...process.env, ...action.env };
		}
		await commandRunner(action.command, action.args, commandOptions);
	}

	removeCordovaPluginDeclarations({
		configPath: paths.config,
		packagePath: paths.package,
		fsImpl,
	});
	assertPluginState({ variant, paths, fsImpl });

	const hasPlatforms =
		fsImpl.existsSync(paths.platforms) &&
		fsImpl
			.readdirSync(paths.platforms)
			.some((entry) => entry && !entry.startsWith("."));

	if (identityChanged && hasPlatforms) {
		console.log("|--- Reinstalling platforms for the new app identity ---|");
		await commandRunner("npm", ["run", "clean"], { cwd: rootDir });
	}

	return {
		actions,
		identityChanged,
		targetId,
	};
}

async function main() {
	const mode = process.argv[2] || "d";
	const variant = process.argv[3] === "free" ? "free" : "paid";
	await configureProject({ mode, variant });
}

if (require.main === module) {
	main().catch((error) => {
		console.error(error);
		process.exitCode = 1;
	});
}

module.exports = {
	ADMOB_PLUGIN_ID,
	ID_FREE,
	ID_PAID,
	LEGACY_CONSENT_PLUGIN_ID,
	configureProject,
	getAdmobSyncPlan,
};

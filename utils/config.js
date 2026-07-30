const fs = require("node:fs");
const path = require("node:path");
const { execFile: execFileCallback } = require("node:child_process");
const { promisify } = require("node:util");

const execFile = promisify(execFileCallback);

const ADMOB_PLUGIN_ID = "admob-plus-cordova";
const ID_PAID = "com.foxdebug.acode";
const ID_FREE = "com.foxdebug.acodefree";
const VARIANTS = new Set(["free", "paid"]);

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
 * @param {{variant:"free"|"paid", bundleExists:boolean, pluginInstalled:boolean}} state
 */
function getAdmobSyncPlan({ variant, bundleExists, pluginInstalled }) {
	if (!VARIANTS.has(variant)) {
		throw new Error(`Unsupported app variant: ${variant}`);
	}

	if (variant === "free" && !bundleExists) {
		throw new Error(
			"Missing src/plugins/admob/www/admob.js. Run `npm run build:admob` before building the free app.",
		);
	}

	const actions = [];
	if (pluginInstalled) {
		actions.push({
			command: "cordova",
			args: ["plugin", "remove", ADMOB_PLUGIN_ID, "--nosave"],
		});
	}

	if (variant === "free") {
		actions.push({
			command: "cordova",
			args: ["plugin", "add", "src/plugins/admob", "--nosave"],
		});
	}

	return actions;
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
 *   commandRunner?:(command:string,args:string[],options:{cwd:string})=>Promise<void>
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
		platforms: path.join(rootDir, "platforms"),
		plugin: path.join(rootDir, "plugins", ADMOB_PLUGIN_ID),
	};

	const config = fsImpl.readFileSync(paths.config, "utf8");
	const currentId = /<widget[^>]*?\sid=["']([^"']+)["']/.exec(config)?.[1];
	if (!currentId) {
		throw new Error(`Unable to read the widget id from ${paths.config}.`);
	}

	const targetId = variant === "free" ? ID_FREE : ID_PAID;
	const identityChanged = currentId !== targetId;
	const actions = getAdmobSyncPlan({
		variant,
		bundleExists: fsImpl.existsSync(paths.bundle),
		pluginInstalled: fsImpl.existsSync(paths.plugin),
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
		await commandRunner(action.command, action.args, { cwd: rootDir });
	}

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
	configureProject,
	getAdmobSyncPlan,
};

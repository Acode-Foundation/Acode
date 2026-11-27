const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { getAppConfig } = require("../config");
const { sync } = require("../sync");
const root = path.resolve(__dirname, "../..");

module.exports = { parseOptions, build, launch };
if (require.main === module) {
	try {
		const args = process.argv.slice(2);
		const options = parseOptions(args);
		if (args.includes("test")) {
			runGradle(`test${capitalize(variantFlavor(options))}DebugUnitTest`);
		} else {
			const artifact = build(options);
			if (args.includes("run")) launch(options, artifact);
		}
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}

function parseOptions(args) {
	if (args.some((arg) => /^(free|paid)$/i.test(arg))) {
		throw new Error(
			"Choose free or paid with package.json androidPackageId; remove the free/paid argument.",
		);
	}
	return {
		...getAppConfig("android"),
		mode: args.some((arg) => ["p", "prod"].includes(arg)) ? "p" : "d",
		channel: args.includes("fdroid") ? "fdroid" : "store",
		bundle: args.includes("bundle"),
		skipWeb: args.includes("--skip-web"),
		target: args.find((arg) => arg.startsWith("--target="))?.slice(9),
		emulator: args.includes("--emulator") || args.includes("-e"),
	};
}

function build(options) {
	sync();
	if (!options.skipWeb) {
		run(
			process.execPath,
			[
				path.join(
					path.dirname(require.resolve("@rspack/cli/package.json")),
					"bin/rspack.js",
				),
				"--mode",
				options.mode === "p" ? "production" : "development",
			],
			{
				ACODE_PLATFORM: "android",
				ACODE_FDROID: String(options.channel === "fdroid"),
			},
		);
	}
	const type = options.mode === "p" ? "release" : "debug";
	const flavor = variantFlavor(options);
	const task = `${options.bundle ? "bundle" : "assemble"}${capitalize(flavor)}${capitalize(type)}`;
	runGradle(task);
	const outputs = path.join(root, "platforms/android/app/build/outputs");
	const extension = options.bundle ? "aab" : "apk";
	const file = `app-${options.variant}-${options.channel}-${type}.${extension}`;
	let source = options.bundle
		? path.join(outputs, "bundle", flavor + capitalize(type), file)
		: path.join(outputs, "apk", flavor, type, file);
	const unsigned = !options.bundle && !fs.existsSync(source);
	if (unsigned) source = source.replace(/\.apk$/, "-unsigned.apk");
	const destination = path.join(
		outputs,
		options.bundle ? "bundle" : "apk",
		type,
		`app-${type}${unsigned ? "-unsigned" : ""}.${extension}`,
	);
	fs.mkdirSync(path.dirname(destination), { recursive: true });
	fs.copyFileSync(source, destination);
	console.log(`Built ${destination}`);
	return destination;
}

function launch(options, artifact) {
	const args = options.target
		? ["-s", options.target]
		: options.emulator
			? ["-e"]
			: [];
	const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
	const adb = sdk
		? path.join(
				sdk,
				"platform-tools",
				process.platform === "win32" ? "adb.exe" : "adb",
			)
		: "adb";
	const id = options.targetId;
	run(adb, [...args, "install", "-r", artifact]);
	run(adb, [
		...args,
		"shell",
		"am",
		"start",
		"-n",
		`${id}/com.foxdebug.acode.MainActivity`,
	]);
}

function gradle() {
	return path.join(
		root,
		"platforms/android",
		process.platform === "win32" ? "gradlew.bat" : "gradlew",
	);
}
function runGradle(task) {
	run(gradle(), ["-p", "platforms/android", `:app:${task}`, "--console=plain"]);
}
function variantFlavor(options) {
	return options.variant + capitalize(options.channel);
}
function capitalize(value) {
	return value[0].toUpperCase() + value.slice(1);
}
function run(command, args, env = {}) {
	const result = spawnSync(command, args, {
		cwd: root,
		env: { ...process.env, ...env },
		stdio: "inherit",
		shell: process.platform === "win32" && command.endsWith(".bat"),
	});
	if (result.error) throw result.error;
	if (result.status !== 0)
		throw new Error(
			`${path.basename(command)} failed with exit code ${result.status}`,
		);
}

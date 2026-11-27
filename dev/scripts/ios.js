const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { getAppConfig } = require("../config");
const { sync } = require("../sync");
const { prepareAds } = require("./iosAds");
const root = path.resolve(__dirname, "../..");

module.exports = { parseOptions, build, launch };
if (require.main === module) {
	try {
		const args = process.argv.slice(2);
		const options = parseOptions(args);
		const artifact =
			args.includes("run") && (!options.target || options.device)
				? prepare(options)
				: build(options);
		if (args.includes("run")) launch(options, artifact);
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}

function parseOptions(args) {
	if (args.some((arg) => /^(free|paid|fdroid|apk|bundle)$/i.test(arg))) {
		throw new Error("iOS has one free edition; use ios dev or ios prod.");
	}
	if (
		args.includes("--device") &&
		args.some((arg) => arg.startsWith("--target="))
	)
		throw new Error(
			"For an iPhone, omit --target and select the device in Xcode.",
		);
	return {
		...getAppConfig("ios"),
		mode: args.some((arg) => ["p", "prod"].includes(arg)) ? "Release" : "Debug",
		action: args.includes("test") ? "test" : "build",
		skipWeb: args.includes("--skip-web"),
		skipTests: args.filter((arg) => arg.startsWith("-skip-testing:")),
		device: args.includes("--device"),
		target: args.find((arg) => arg.startsWith("--target="))?.slice(9),
	};
}

function prepare(options) {
	if (process.platform !== "darwin")
		throw new Error("iOS builds require macOS and Xcode.");
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
				options.mode === "Release" ? "production" : "development",
			],
			{ ACODE_PLATFORM: "ios", ACODE_FDROID: "false" },
		);
	}
	prepareAds(options.mode);
}

function build(options) {
	if (options.action === "test" && (!options.target || options.device))
		throw new Error("iOS tests require --target=<simulator UUID>.");
	prepare(options);
	const sdk = options.device ? "iphoneos" : "iphonesimulator";
	run("xcodebuild", [
		"-project",
		"platforms/ios/runner.xcodeproj",
		"-scheme",
		"runner",
		"-configuration",
		options.mode,
		"-sdk",
		sdk,
		"-destination",
		options.action === "test"
			? `platform=iOS Simulator,id=${options.target}`
			: options.device
				? "generic/platform=iOS"
				: "generic/platform=iOS Simulator",
		"-derivedDataPath",
		".ios-build",
		"-clonedSourcePackagesDirPath",
		".ios-build/SourcePackages",
		...(options.device
			? ["CODE_SIGNING_ALLOWED=NO"]
			: ["CODE_SIGNING_ALLOWED=YES", "CODE_SIGN_IDENTITY=-"]),
		...(options.action === "test"
			? [
					"-parallel-testing-enabled",
					"NO",
					"-collect-test-diagnostics",
					"never",
					...(options.skipTests || []),
				]
			: []),
		options.action,
	]);
	const artifact = path.join(
		root,
		".ios-build/Build/Products",
		`${options.mode}-${sdk}`,
		"runner.app",
	);
	console.log(`${options.action === "test" ? "Tested" : "Built"} ${artifact}`);
	return artifact;
}

function launch(options, artifact) {
	if (options.device || !options.target) {
		run("open", [
			"-b",
			"com.apple.dt.Xcode",
			path.join(root, "platforms/ios/runner.xcodeproj"),
		]);
		console.log(
			"In Xcode, select the runner scheme and your iPhone, then press Cmd+R to build and install.",
		);
		if (options.mode === "Release")
			console.log("Set the scheme's Run build configuration to Release.");
		return;
	}
	const target = options.target;
	const devices = JSON.parse(
		run(
			"xcrun",
			["simctl", "list", "devices", "available", "--json"],
			{},
			true,
		),
	);
	const device = Object.values(devices.devices)
		.flat()
		.find((device) => device.udid === target);
	if (!device)
		throw new Error(
			`Simulator ${target} not found. For an iPhone, omit --target and select the device in Xcode.`,
		);
	if (device.state !== "Booted") run("xcrun", ["simctl", "boot", target]);
	run("xcrun", ["simctl", "bootstatus", target, "-b"]);
	spawnSync("xcrun", ["simctl", "terminate", target, options.targetId], {
		stdio: "ignore",
	});
	run("xcrun", ["simctl", "install", target, artifact]);
	run("xcrun", ["simctl", "launch", target, options.targetId]);
}

function run(command, args, env = {}, capture = false) {
	const result = spawnSync(command, args, {
		cwd: root,
		env: { ...process.env, ...env },
		stdio: capture ? "pipe" : "inherit",
		encoding: "utf8",
	});
	if (result.error) throw result.error;
	if (result.status !== 0)
		throw new Error(
			result.stderr || `${command} failed with exit code ${result.status}`,
		);
	return result.stdout;
}

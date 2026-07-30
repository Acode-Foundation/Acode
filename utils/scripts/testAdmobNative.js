const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function getGradleCommand({
	androidDir,
	platform = process.platform,
	existsSync = fs.existsSync,
}) {
	const wrapperName = platform === "win32" ? "gradlew.bat" : "gradlew";
	const wrapperPath = path.join(androidDir, wrapperName);
	return existsSync(wrapperPath) ? wrapperPath : "gradle";
}

function runNativeTests({
	rootDir = path.resolve(__dirname, "../.."),
	platform = process.platform,
	existsSync = fs.existsSync,
	spawn = spawnSync,
} = {}) {
	const androidDir = path.join(rootDir, "platforms", "android");
	if (!existsSync(androidDir)) {
		throw new Error(
			"Missing platforms/android. Add the Cordova Android platform before running native tests.",
		);
	}

	const command = getGradleCommand({ androidDir, platform, existsSync });
	const result = spawn(command, [":app:testDebugUnitTest"], {
		cwd: androidDir,
		stdio: "inherit",
		shell: platform === "win32",
	});

	if (result.error) {
		if (result.error.code === "ENOENT" && command === "gradle") {
			throw new Error(
				"Gradle is unavailable and this Android platform has no Gradle wrapper.",
				{ cause: result.error },
			);
		}
		throw result.error;
	}

	if (result.status !== 0) {
		throw new Error(
			`AdMob Android tests failed with exit code ${result.status}.`,
		);
	}
}

if (require.main === module) {
	try {
		runNativeTests();
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}

module.exports = {
	getGradleCommand,
	runNativeTests,
};

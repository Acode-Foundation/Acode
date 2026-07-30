const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { getGradleCommand, runNativeTests } = require("./testAdmobNative");

test("uses the platform Gradle wrapper when it exists", () => {
	const androidDir = path.join("workspace", "platforms", "android");
	const command = getGradleCommand({
		androidDir,
		platform: "linux",
		existsSync: (candidate) => candidate.endsWith("gradlew"),
	});

	assert.equal(command, path.join(androidDir, "gradlew"));
});

test("falls back to configured system Gradle for a fresh platform", () => {
	assert.equal(
		getGradleCommand({
			androidDir: path.join("workspace", "platforms", "android"),
			existsSync: () => false,
		}),
		"gradle",
	);
});

test("runs the Android unit-test task from the platform directory", () => {
	const calls = [];
	const rootDir = path.resolve("workspace");

	runNativeTests({
		rootDir,
		existsSync: () => true,
		spawn(command, args, options) {
			calls.push({ command, args, options });
			return { status: 0 };
		},
	});

	assert.deepEqual(calls, [
		{
			command: path.join(rootDir, "platforms", "android", "gradlew"),
			args: [":app:testDebugUnitTest"],
			options: {
				cwd: path.join(rootDir, "platforms", "android"),
				stdio: "inherit",
				shell: false,
			},
		},
	]);
});

test("reports a missing Android platform before spawning Gradle", () => {
	assert.throws(
		() =>
			runNativeTests({
				rootDir: path.resolve("workspace"),
				existsSync: () => false,
			}),
		/Missing platforms\/android/,
	);
});

import childProcess from "node:child_process";
import { createRequire } from "node:module";
import { afterEach, expect, test, vi } from "vitest";

const require = createRequire(import.meta.url);
const scriptPath = require.resolve("../../dev/scripts/android.js");

afterEach(() => {
	delete require.cache[scriptPath];
	vi.restoreAllMocks();
});

test.each([
	"com.foxdebug.acode",
	"com.foxdebug.acodefree",
])("launches %s using the shared activity namespace", (targetId) => {
	const spawn = vi
		.spyOn(childProcess, "spawnSync")
		.mockReturnValue({ status: 0 });
	delete require.cache[scriptPath];
	const { launch } = require(scriptPath);

	launch({ targetId, target: "device" }, "/tmp/app-debug.apk");

	expect(spawn.mock.calls.map(([, args]) => args)).toEqual([
		["-s", "device", "install", "-r", "/tmp/app-debug.apk"],
		[
			"-s",
			"device",
			"shell",
			"am",
			"start",
			"-n",
			`${targetId}/com.foxdebug.acode.MainActivity`,
		],
	]);
});

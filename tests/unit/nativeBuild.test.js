import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import { expect, test, vi } from "vitest";

const require = createRequire(import.meta.url);
const filename = path.resolve(
	import.meta.dirname,
	"../../dev/scripts/native.js",
);
const source = fs.readFileSync(filename, "utf8");
const { getAdConfig } = require("../../dev/config.js");
const ads = require("../../ads.json");

test.each([
	[[], "android", "Release"],
	[["android", "bundle"], "android", "Release"],
	[["ios"], "ios", "Release"],
	[["ios", "--device"], "ios", "Release"],
	[["android", "dev"], "android", "Debug"],
	[["ios", "d"], "ios", "Debug"],
	[["run", "ios"], "ios", "Debug"],
	[["run", "android"], "android", "Debug"],
	[["test", "ios", "--target=simulator"], "ios", "Debug"],
	[["run", "ios", "prod"], "ios", "Release"],
])("native command %j selects %s %s and its matching ad IDs", (args, platform, mode) => {
	const spawn = vi.fn(() => ({ status: 0 }));
	const scriptProcess = {
		argv: [process.execPath, filename, ...args],
		execPath: process.execPath,
	};

	vm.runInNewContext(
		source,
		{
			require: (name) =>
				name === "node:child_process" ? { spawnSync: spawn } : require(name),
			process: scriptProcess,
			__dirname: path.dirname(filename),
		},
		{ filename },
	);

	expect(spawn).toHaveBeenCalledOnce();
	const [command, [script, ...forwardedArgs]] = spawn.mock.calls[0];
	expect(command).toBe(process.execPath);
	expect(script).toBe(path.join(path.dirname(filename), `${platform}.js`));
	expect(forwardedArgs).toEqual(expect.arrayContaining(args));
	const options = require(script).parseOptions(forwardedArgs);
	expect(options.mode).toBe(
		platform === "ios" ? mode : mode === "Release" ? "p" : "d",
	);
	expect(getAdConfig(platform, mode)).toEqual(
		ads[platform][mode === "Release" ? "production" : "test"],
	);
	expect(scriptProcess.exitCode).toBe(0);
});

import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import { expect, test, vi } from "vitest";

const require = createRequire(import.meta.url);
const filename = path.resolve(import.meta.dirname, "../../dev/scripts/ios.js");
const source = fs.readFileSync(filename, "utf8");

test.each([
	{ args: [] },
	{ args: ["--device"] },
])("iOS run $args opens Xcode without requiring a booted simulator", ({
	args,
}) => {
	const result = runScript(["run", ...args]);
	expect(result.process.exitCode).toBeUndefined();
	expect(result.spawn.mock.calls.map(([command]) => command)).toEqual([
		process.execPath,
		"open",
	]);
	expect(result.spawn.mock.calls[1][1]).toEqual([
		"-b",
		"com.apple.dt.Xcode",
		expect.stringMatching(/runner\.xcodeproj$/),
	]);
	expect(result.log.mock.calls.flat().join("\n")).toContain("Xcode");
});

test("iPhone development always prepares advertising metadata before opening Xcode", () => {
	const result = runScript(["run", "--device", "--skip-web"]);
	expect(result.process.exitCode).toBeUndefined();
	expect(result.prepareAds).toHaveBeenCalledWith("Debug");
	expect(result.spawn.mock.calls.map(([command]) => command)).toEqual(["open"]);
	expect(result.log.mock.calls.flat().join("\n")).toContain("runner scheme");
});

test("preparing native files syncs package identity before opening Xcode", () => {
	const result = runScript(["run", "--device", "--skip-web"]);
	expect(result.process.exitCode).toBeUndefined();
	expect(result.sync).toHaveBeenCalledOnce();
});

test("an explicit simulator target still builds, boots, installs and launches", () => {
	const result = runScript(["run", "--target=simulator", "--skip-web"]);
	expect(result.process.exitCode).toBeUndefined();
	const calls = result.spawn.mock.calls;
	expect(calls.find(([command]) => command === "xcodebuild")[1]).toContain(
		"iphonesimulator",
	);
	expect(calls.some(([command]) => command === "open")).toBe(false);
	expect(calls.map(([, args]) => args)).toContainEqual([
		"simctl",
		"boot",
		"simulator",
	]);
	expect(calls.map(([, args]) => args)).toContainEqual([
		"simctl",
		"install",
		"simulator",
		expect.stringMatching(/Debug-iphonesimulator\/runner\.app$/),
	]);
	expect(calls.map(([, args]) => args)).toContainEqual([
		"simctl",
		"launch",
		"simulator",
		"app.acode",
	]);
});

test("a device build remains unsigned until the user runs it through Xcode", () => {
	const result = runScript(["--device", "--skip-web"]);
	expect(result.process.exitCode).toBeUndefined();
	expect(result.spawn).toHaveBeenCalledOnce();
	expect(result.spawn.mock.calls[0][0]).toBe("xcodebuild");
	expect(result.spawn.mock.calls[0][1]).toEqual(
		expect.arrayContaining(["iphoneos", "CODE_SIGNING_ALLOWED=NO"]),
	);
});

test("a simulator selector cannot silently override physical-device mode", () => {
	const result = runScript(["run", "--device", "--target=phone", "--skip-web"]);
	expect(result.process.exitCode).toBe(1);
	expect(result.spawn).not.toHaveBeenCalled();
	expect(result.error.mock.calls.flat().join("\n")).toMatch(/select.*Xcode/i);
});

test.each([
	[],
	[
		"-skip-testing:runnerTests/AlpineSignalTests",
		"-skip-testing:runnerTests/InAppRunnerTests",
	],
])("iOS tests forward only explicit exclusions: %j", (...filters) => {
	const result = runScript([
		"test",
		"--target=simulator",
		"--skip-web",
		...filters,
	]);
	expect(result.process.exitCode).toBeUndefined();
	const args = result.spawn.mock.calls.find(
		([command]) => command === "xcodebuild",
	)[1];
	expect(args.at(-1)).toBe("test");
	expect(args.filter((arg) => arg.startsWith("-skip-testing:"))).toEqual(
		filters,
	);
});

function runScript(args) {
	const spawn = vi.fn(() => ({ status: 0, stdout: "", stderr: "" }));
	spawn.mockImplementation((command, args) => ({
		status: 0,
		stdout:
			command === "xcrun" && args[1] === "list"
				? JSON.stringify({
						devices: { iOS: [{ udid: "simulator", state: "Shutdown" }] },
					})
				: "",
		stderr: "",
	}));
	const prepareAds = vi.fn();
	const sync = vi.fn();
	const module = { exports: {} };
	const scriptProcess = {
		argv: [process.execPath, filename, ...args],
		execPath: process.execPath,
		platform: "darwin",
		env: {},
	};
	const scriptRequire = (name) => {
		if (name === "node:child_process") return { spawnSync: spawn };
		if (name === "../config")
			return {
				getAppConfig: () => ({ variant: "free", targetId: "app.acode" }),
			};
		if (name === "../sync") return { sync };
		if (name === "./iosAds") return { prepareAds };
		return require(name);
	};
	scriptRequire.main = module;
	scriptRequire.resolve = require.resolve;
	const log = vi.fn();
	const error = vi.fn();
	vm.runInNewContext(
		source,
		{
			require: scriptRequire,
			module,
			process: scriptProcess,
			console: { log, error },
			__dirname: path.dirname(filename),
		},
		{ filename },
	);
	return { spawn, prepareAds, sync, process: scriptProcess, log, error };
}

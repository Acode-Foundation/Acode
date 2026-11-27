import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";

const require = createRequire(import.meta.url);
const { getAppConfig } = require("../../dev/config.js");
const { parseOptions } = require("../../dev/scripts/android.js");
const { parseOptions: parseIOSOptions } = require("../../dev/scripts/ios.js");
const packagePath = path.resolve(import.meta.dirname, "../../package.json");

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
});

test.each([
	["com.foxdebug.acode", "paid"],
	["com.foxdebug.acodefree", "free"],
])("selects %s from androidPackageId for build and dev", (androidPackageId, variant) => {
	const readFile = fs.readFileSync;
	vi.spyOn(fs, "readFileSync").mockImplementation((file, ...args) =>
		file === packagePath
			? JSON.stringify({
					name: "unrelated.npm.name",
					androidPackageId,
					appleAppId: "app.acode",
				})
			: readFile(file, ...args),
	);
	expect(getAppConfig()).toEqual({ targetId: androidPackageId, variant });
	expect(
		parseOptions(["android", "prod", "bundle", "fdroid", "--target=device"]),
	).toMatchObject({
		targetId: androidPackageId,
		variant,
		mode: "p",
		bundle: true,
		channel: "fdroid",
		target: "device",
	});
	expect(parseIOSOptions(["ios", "prod", "--target=simulator"])).toMatchObject({
		targetId: "app.acode",
		variant: "free",
		mode: "Release",
		target: "simulator",
		device: false,
	});
	vi.stubEnv("ACODE_PLATFORM", "ios");
	expect(getAppConfig()).toEqual({ targetId: "app.acode", variant: "free" });
	expect(parseOptions([])).toMatchObject({
		targetId: androidPackageId,
		variant,
	});
});

test.each([
	"free",
	"paid",
	"fdroid",
	"apk",
	"bundle",
])("rejects Android-only %s arguments for iOS", (argument) => {
	expect(() => parseIOSOptions(["ios", argument])).toThrow(
		/iOS has one free edition/,
	);
});

test("rereads package identity after an edit and rejects unsupported android package ids", () => {
	const readFile = fs.readFileSync;
	let androidPackageId = "com.foxdebug.acode";
	vi.spyOn(fs, "readFileSync").mockImplementation((file, ...args) =>
		file === packagePath
			? JSON.stringify({ androidPackageId, appleAppId: "app.acode" })
			: readFile(file, ...args),
	);
	expect(parseOptions([]).variant).toBe("paid");
	androidPackageId = "com.foxdebug.acodefree";
	expect(parseOptions([]).variant).toBe("free");
	androidPackageId = "invalid.package";
	expect(() => parseOptions([])).toThrow(/androidPackageId/);
});

test.each([
	"free",
	"paid",
	"FREE",
	"PAID",
])("rejects the removed %s argument instead of silently building a different edition", (argument) => {
	expect(() => parseOptions([argument, "dev", "apk"])).toThrow(
		/androidPackageId/,
	);
});

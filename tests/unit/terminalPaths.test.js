import { describe, expect, it } from "vitest";
import {
	getTerminalPaths,
	isTerminalAccessibleUrl,
	prootPathToTerminalUrl,
	terminalUrlToProotPath,
} from "lib/terminalPaths";

const options = {
	filesDir: "/data/user/0/com.foxdebug.acode/files",
	packageName: "com.foxdebug.acode",
};

describe("terminal path mapping", () => {
	it("maps Public and both untouched legacy roots without prefix confusion", () => {
		const paths = getTerminalPaths(options);
		expect(terminalUrlToProotPath(`file://${paths.publicDir}/app`, options)).toBe(
			"/public/app",
		);
		expect(
			terminalUrlToProotPath(`file://${paths.legacyHomeDir}/project`, options),
		).toBe("/legacy-home/project");
		expect(
			terminalUrlToProotPath(`file://${paths.legacyRootDir}/.profile`, options),
		).toBe("/legacy-root/.profile");
		expect(
			isTerminalAccessibleUrl(`file://${paths.publicDir}-backup`, options),
		).toBe(false);
	});

	it("maps current home aliases to Public and recovery mounts to originals", () => {
		const paths = getTerminalPaths(options);
		expect(prootPathToTerminalUrl("/home/app/index.js", options)).toBe(
			`file://${paths.publicDir}/app/index.js`,
		);
		expect(prootPathToTerminalUrl("/root/.ashrc", options)).toBe(
			`file://${paths.publicDir}/.ashrc`,
		);
		expect(prootPathToTerminalUrl("/legacy-home/app", options)).toBe(
			`file://${paths.legacyHomeDir}/app`,
		);
	});

	it("converts document-provider IDs for legacy roots", () => {
		const paths = getTerminalPaths(options);
		const uri =
			"content://com.foxdebug.acode.documents/tree/" +
			encodeURIComponent(paths.legacyHomeDir) +
			`::${encodeURIComponent(`${paths.legacyHomeDir}/project`)}`;
		expect(terminalUrlToProotPath(uri, options)).toBe("/legacy-home/project");
	});
});

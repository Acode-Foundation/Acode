import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const rootDir = fileURLToPath(new URL("../..", import.meta.url));
const scriptsDir = `${rootDir}/src/plugins/terminal/scripts`;
const sandboxScriptPath = `${scriptsDir}/init-sandbox.sh`;
const alpineScriptPath = `${scriptsDir}/init-alpine.sh`;
const terminalJsPath = `${rootDir}/src/plugins/terminal/www/Terminal.js`;

const sandboxScript = fs.readFileSync(sandboxScriptPath, "utf8");
const alpineScript = fs.readFileSync(alpineScriptPath, "utf8");
const terminalJs = fs.readFileSync(terminalJsPath, "utf8");

describe("terminal home layout shell integration", () => {
	it("keeps both scripts valid POSIX shell", () => {
		for (const scriptPath of [sandboxScriptPath, alpineScriptPath]) {
			expect(() => execFileSync("sh", ["-n", scriptPath])).not.toThrow();
		}
	});

	it("defaults to the merged layout when the marker is missing", () => {
		expect(sandboxScript).toContain("MERGED_HOME_DIRS=true");
		expect(sandboxScript).toContain("terminal_home_mode");
		expect(sandboxScript).toContain('[ "$MERGED_HOME_DIRS" = "true" ]');
	});

	it("only binds /home and /root while merged", () => {
		const mergedGuard = sandboxScript.indexOf(
			'if [ "$MERGED_HOME_DIRS" = "true" ]; then',
		);
		expect(mergedGuard).toBeGreaterThan(-1);
		expect(sandboxScript.indexOf("public:/home")).toBeGreaterThan(mergedGuard);
		expect(sandboxScript.indexOf("public:/root")).toBeGreaterThan(mergedGuard);
	});

	it("switches HOME with the selected layout", () => {
		expect(alpineScript).toContain("export HOME=/public");
		expect(alpineScript).toContain("export HOME=/home");
		expect(alpineScript).toContain('export HOME="${ACODE_HOME:-/public}"');
		expect(alpineScript).toContain("sed -i");
	});

	it("uses the same marker file from JavaScript and shell", () => {
		expect(terminalJs).toContain("terminal_home_mode");
		expect(sandboxScript).toContain("terminal_home_mode");
	});

	it("marks legacy migration complete in both layouts", () => {
		expect(terminalJs).toContain('touch "$MIGRATE/.migrated"');
		expect(terminalJs).toContain("if (!merged)");
	});
});

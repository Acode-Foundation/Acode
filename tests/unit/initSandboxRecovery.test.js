import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const script = fs.readFileSync(
	fileURLToPath(
		new URL(
			"../../src/plugins/terminal/scripts/init-sandbox.sh",
			import.meta.url,
		),
	),
	"utf8",
);

describe("terminal sandbox legacy mounts", () => {
	it("never migrates legacy files implicitly at startup", () => {
		expect(script).not.toContain("move_all");
		expect(script).not.toMatch(/find[^\n]+-exec\s+mv/);
	});

	it("mounts both untouched legacy roots at explicit recovery paths", () => {
		expect(script).toContain(
			'ARGS="$ARGS -b $PREFIX/alpine/home:/legacy-home"',
		);
		expect(script).toContain(
			'ARGS="$ARGS -b $PREFIX/alpine/root:/legacy-root"',
		);
	});
});

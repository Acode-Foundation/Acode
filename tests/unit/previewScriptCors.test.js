import fs from "node:fs";
import { describe, expect, it } from "vitest";

const runSource = fs.readFileSync(
	new URL("../../src/lib/run.js", import.meta.url),
	"utf8",
);

describe("HTML preview script loading", () => {
	it("does not force crossorigin on user scripts", () => {
		// CDNs without CORS headers (e.g. cdn.tailwindcss.com) fail when a
		// script tag is rewritten to crossorigin="anonymous".
		expect(runSource).not.toMatch(/replace\([^\n]*crossorigin/);
	});

	it("keeps crossorigin on the same-origin console script", () => {
		expect(runSource).toContain(
			'src="/${CONSOLE_SCRIPT}" crossorigin="anonymous"',
		);
	});
});

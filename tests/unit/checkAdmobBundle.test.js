import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { onTestFinished, test } from "vitest";

const requireFromTest = createRequire(import.meta.url);
const { validateAdmobBundle } = requireFromTest(
	"../../utils/scripts/checkAdmobBundle.js",
);

function createFixture(bundle) {
	const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "acode-admob-bundle-"));
	const bundlePath = path.join(rootDir, "www/admob.js");
	const pluginXmlPath = path.join(rootDir, "plugin.xml");
	fs.mkdirSync(path.dirname(bundlePath), { recursive: true });
	fs.writeFileSync(bundlePath, bundle);
	fs.writeFileSync(
		pluginXmlPath,
		'<plugin><js-module src="www/admob.js" /></plugin>',
	);

	return {
		bundlePath,
		pluginXmlPath,
		remove() {
			fs.rmSync(rootDir, { recursive: true });
		},
	};
}

test("accepts a self-contained Cordova bundle with the privacy API", () => {
	const fixture = createFixture(`
		const cordova = require("cordova");
		const channel = require("cordova/channel");
		const exec = require("cordova/exec");
		function gatherConsent() {}
		function showOptions() {}
	`);
	onTestFinished(fixture.remove);

	assert.deepEqual(validateAdmobBundle(fixture), {
		bytes: fs.statSync(fixture.bundlePath).size,
		imports: ["cordova", "cordova/channel", "cordova/exec"],
	});
});

test("rejects unresolved relative imports", () => {
	const fixture = createFixture(`
		require("./ads/base");
		function gatherConsent() {}
		function showOptions() {}
	`);
	onTestFinished(fixture.remove);

	assert.throws(
		() => validateAdmobBundle(fixture),
		/unresolved imports: \.\/ads\/base/,
	);
});

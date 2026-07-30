const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { validateAdmobBundle } = require("./checkAdmobBundle");

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

test("accepts a self-contained Cordova bundle with the privacy API", (t) => {
	const fixture = createFixture(`
		const cordova = require("cordova");
		const channel = require("cordova/channel");
		const exec = require("cordova/exec");
		function gatherConsent() {}
		function showOptions() {}
	`);
	t.after(fixture.remove);

	assert.deepEqual(validateAdmobBundle(fixture), {
		bytes: fs.statSync(fixture.bundlePath).size,
		imports: ["cordova", "cordova/channel", "cordova/exec"],
	});
});

test("rejects unresolved relative imports", (t) => {
	const fixture = createFixture(`
		require("./ads/base");
		function gatherConsent() {}
		function showOptions() {}
	`);
	t.after(fixture.remove);

	assert.throws(
		() => validateAdmobBundle(fixture),
		/unresolved imports: \.\/ads\/base/,
	);
});

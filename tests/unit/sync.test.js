import fs from "node:fs";
import { createRequire } from "node:module";
import { afterEach, expect, test, vi } from "vitest";

const require = createRequire(import.meta.url);
const { patchProjectFile, patchDisplayName } = require("../../dev/sync.js");

afterEach(() => vi.restoreAllMocks());

test("patchProjectFile syncs version, versionCode, bundle ids and display name", () => {
	let content = [
		"MARKETING_VERSION = 1.0.0;",
		"CURRENT_PROJECT_VERSION = 1;",
		"PRODUCT_BUNDLE_IDENTIFIER = app.acode;",
		"PRODUCT_BUNDLE_IDENTIFIER = app.acode.tests;",
		'PRODUCT_BUNDLE_IDENTIFIER = "app.acode.ui-tests";',
		"INFOPLIST_KEY_CFBundleDisplayName = Old Name;",
	].join("\n");
	vi.spyOn(fs, "readFileSync").mockImplementation(() => content);
	vi.spyOn(fs, "writeFileSync").mockImplementation((file, next) => {
		content = next;
	});

	patchProjectFile({
		version: "2.3.4",
		versionCode: 99,
		appleAppId: "com.example.app",
		displayName: "Example",
	});

	expect(content).toContain("MARKETING_VERSION = 2.3.4;");
	expect(content).toContain("CURRENT_PROJECT_VERSION = 99;");
	expect(content).toContain("PRODUCT_BUNDLE_IDENTIFIER = com.example.app;");
	expect(content).toContain(
		"PRODUCT_BUNDLE_IDENTIFIER = com.example.app.tests;",
	);
	expect(content).toContain(
		'PRODUCT_BUNDLE_IDENTIFIER = "com.example.app.ui-tests";',
	);
	expect(content).toContain("INFOPLIST_KEY_CFBundleDisplayName = Example;");
});

test("patchProjectFile leaves the project untouched when values already match", () => {
	const content = [
		"MARKETING_VERSION = 2.3.4;",
		"CURRENT_PROJECT_VERSION = 99;",
		"PRODUCT_BUNDLE_IDENTIFIER = com.example.app;",
		"PRODUCT_BUNDLE_IDENTIFIER = com.example.app.tests;",
		'PRODUCT_BUNDLE_IDENTIFIER = "com.example.app.ui-tests";',
		"INFOPLIST_KEY_CFBundleDisplayName = Example;",
	].join("\n");
	vi.spyOn(fs, "readFileSync").mockReturnValue(content);
	const write = vi.spyOn(fs, "writeFileSync").mockImplementation(() => {});

	patchProjectFile({
		version: "2.3.4",
		versionCode: 99,
		appleAppId: "com.example.app",
		displayName: "Example",
	});

	expect(write).not.toHaveBeenCalled();
});

test("patchDisplayName syncs the name across native and web files", () => {
	const files = {
		"runner/Info.plist":
			"<key>CFBundleDisplayName</key>\n\t<string>Old</string>\n<key>CFBundleName</key>\n\t<string>runner</string>",
		"values/strings.xml":
			'<resources><string name="app_name">Old</string></resources>',
		"settings.gradle.kts": 'rootProject.name = "Old"',
		"src/index.html": "<title>Old</title>",
	};
	const writes = {};
	vi.spyOn(fs, "readFileSync").mockImplementation((file) => {
		const key = Object.keys(files).find((name) => file.endsWith(name));
		if (!key) throw new Error(`unexpected read: ${file}`);
		return files[key];
	});
	vi.spyOn(fs, "writeFileSync").mockImplementation((file, content) => {
		const key = Object.keys(files).find((name) => file.endsWith(name));
		if (key) writes[key] = content;
	});

	patchDisplayName({ displayName: "Example" });

	expect(writes["runner/Info.plist"]).toContain(
		"<key>CFBundleDisplayName</key>\n\t<string>Example</string>",
	);
	expect(writes["runner/Info.plist"]).toContain(
		"<key>CFBundleName</key>\n\t<string>Example</string>",
	);
	expect(writes["values/strings.xml"]).toContain('name="app_name">Example<');
	expect(writes["settings.gradle.kts"]).toContain(
		'rootProject.name = "Example"',
	);
	expect(writes["src/index.html"]).toContain("<title>Example</title>");
});

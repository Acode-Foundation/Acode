import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

const rootDir = fileURLToPath(new URL("../..", import.meta.url));

function read(relativePath) {
	return fs.readFileSync(path.join(rootDir, relativePath), "utf8");
}

test("Android release builds stay edge-to-edge safe and conservatively optimized", () => {
	const theme = read("res/android/values/themes.xml");
	const buildExtras = read("build-extras.gradle");
	const proguardRules = read("proguard-rules.pro");

	assert.doesNotMatch(theme, /windowOptOutEdgeToEdgeEnforcement/);
	assert.match(buildExtras, /release\s*\{[\s\S]*minifyEnabled\s+true/);
	assert.match(buildExtras, /release\s*\{[\s\S]*shrinkResources\s+true/);
	assert.match(buildExtras, /proguard-android-optimize\.txt/);
	assert.match(buildExtras, /rootProject\.file\('\.\.\/\.\.\/proguard-rules\.pro'\)/);
	assert.doesNotMatch(
		proguardRules,
		/^\s*-(?:ignorewarnings|dontoptimize|dontobfuscate)\b/m,
	);
	assert.deepEqual(
		proguardRules.match(/^\s*-dontwarn\s+\S+\s*$/gm)?.map((rule) => rule.trim()),
		[
			"-dontwarn java.lang.management.ManagementFactory",
			"-dontwarn java.lang.management.ThreadInfo",
			"-dontwarn java.lang.management.ThreadMXBean",
		],
	);
	assert.doesNotMatch(
		read("src/plugins/sftp/src/com/foxdebug/sftp/Sftp.java"),
		/maverick\.threadDump/,
	);

	const keptPrefixes = [
		"org.apache.cordova.",
		"com.foxdebug.",
		"com.silkimen.",
		"com.verso.",
		"admob.plus.",
		"com.sshtools.",
		"org.bouncycastle.",
	];
	for (const prefix of keptPrefixes) {
		assert.ok(
			proguardRules.includes(`-keep class ${prefix}** { *; }`),
			`Missing conservative keep rule for ${prefix}`,
		);
	}
	assert.match(proguardRules, /-keep class \*\*\.BuildConfig \{ \*; \}/);

	const pluginRoot = path.join(rootDir, "src/plugins");
	const featureClasses = fs
		.readdirSync(pluginRoot, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.flatMap((entry) => {
			const pluginXmlPath = path.join(pluginRoot, entry.name, "plugin.xml");
			if (!fs.existsSync(pluginXmlPath)) return [];
			const pluginXml = fs.readFileSync(pluginXmlPath, "utf8");
			return [...pluginXml.matchAll(/<param\b[^>]*>/g)]
				.map(([param]) => ({
					name: /\bname=["']([^"']+)["']/.exec(param)?.[1],
					value: /\bvalue=["']([^"']+)["']/.exec(param)?.[1],
				}))
				.filter(({ name, value }) => name === "android-package" && value)
				.map(({ value }) => value);
		});

	assert.ok(featureClasses.length > 0, "No Cordova Android feature classes found");
	for (const className of featureClasses) {
		assert.ok(
			keptPrefixes.some((prefix) => className.startsWith(prefix)),
			`Cordova feature class is not covered by an R8 keep rule: ${className}`,
		);
	}
});

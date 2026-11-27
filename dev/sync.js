const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const packageFile = path.join(root, "package.json");
const projectFile = path.join(
	root,
	"platforms/ios/runner.xcodeproj/project.pbxproj",
);
const infoPlistFile = path.join(root, "platforms/ios/runner/Info.plist");
const stringsFile = path.join(
	root,
	"platforms/android/app/src/main/res/values/strings.xml",
);
const settingsGradleFile = path.join(
	root,
	"platforms/android/settings.gradle.kts",
);
const indexHtmlFile = path.join(root, "src/index.html");

module.exports = { sync, patchProjectFile, patchDisplayName };

function sync() {
	const pkg = JSON.parse(fs.readFileSync(packageFile, "utf8"));
	patchProjectFile(pkg);
	patchDisplayName(pkg);
}

function patchProjectFile(pkg) {
	patchFile(projectFile, (content) =>
		content
			.replace(
				/MARKETING_VERSION = [^;]+;/g,
				`MARKETING_VERSION = ${pkg.version};`,
			)
			.replace(
				/CURRENT_PROJECT_VERSION = [^;]+;/g,
				`CURRENT_PROJECT_VERSION = ${pkg.versionCode};`,
			)
			.replace(
				/PRODUCT_BUNDLE_IDENTIFIER = ("?)([^";]+)\1;/g,
				(match, quote, bundleId) => {
					if (bundleId.endsWith(".ui-tests"))
						return `PRODUCT_BUNDLE_IDENTIFIER = "${pkg.appleAppId}.ui-tests";`;
					if (bundleId.endsWith(".tests"))
						return `PRODUCT_BUNDLE_IDENTIFIER = ${pkg.appleAppId}.tests;`;
					return `PRODUCT_BUNDLE_IDENTIFIER = ${pkg.appleAppId};`;
				},
			)
			.replace(
				/INFOPLIST_KEY_CFBundleDisplayName = [^;]+;/g,
				`INFOPLIST_KEY_CFBundleDisplayName = ${pkg.displayName};`,
			),
	);
}

function patchDisplayName(pkg) {
	patchFile(infoPlistFile, (content) =>
		content.replace(
			/(<key>CFBundle(?:Display)?Name<\/key>\s*\n\s*<string>)[^<]*(<\/string>)/g,
			`$1${pkg.displayName}$2`,
		),
	);
	patchFile(stringsFile, (content) =>
		content.replace(
			/(<string name="app_name">)[^<]*(<\/string>)/,
			`$1${pkg.displayName}$2`,
		),
	);
	patchFile(settingsGradleFile, (content) =>
		content.replace(
			/(rootProject\.name\s*=\s*")[^"]*(")/,
			`$1${pkg.displayName}$2`,
		),
	);
	patchFile(indexHtmlFile, (content) =>
		content.replace(/(<title>)[^<]*(<\/title>)/, `$1${pkg.displayName}$2`),
	);
}

function patchFile(file, transform) {
	const content = fs.readFileSync(file, "utf8");
	const updated = transform(content);
	if (updated !== content) fs.writeFileSync(file, updated, "utf8");
}

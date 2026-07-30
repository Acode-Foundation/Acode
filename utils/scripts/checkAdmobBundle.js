const fs = require("node:fs");
const path = require("node:path");

const ALLOWED_IMPORTS = new Set(["cordova", "cordova/channel", "cordova/exec"]);
const REQUIRE_PATTERN = /\brequire\(\s*["']([^"']+)["']\s*\)/g;

/**
 * Validates that the Cordova runtime artifact is a self-contained bundle.
 *
 * @param {{bundlePath:string, pluginXmlPath:string, fsImpl?:typeof fs}} options
 */
function validateAdmobBundle({ bundlePath, pluginXmlPath, fsImpl = fs }) {
	if (!fsImpl.existsSync(bundlePath)) {
		throw new Error(`Missing AdMob runtime bundle: ${bundlePath}`);
	}

	const pluginXml = fsImpl.readFileSync(pluginXmlPath, "utf8");
	const relativeBundlePath = path
		.relative(path.dirname(pluginXmlPath), bundlePath)
		.split(path.sep)
		.join("/");
	if (!pluginXml.includes(`src="${relativeBundlePath}"`)) {
		throw new Error(
			`plugin.xml does not reference the runtime bundle at ${relativeBundlePath}.`,
		);
	}

	const bundle = fsImpl.readFileSync(bundlePath, "utf8");
	const imports = [...bundle.matchAll(REQUIRE_PATTERN)].map(
		(match) => match[1],
	);
	const unsupportedImports = imports.filter(
		(specifier) => !ALLOWED_IMPORTS.has(specifier),
	);

	if (unsupportedImports.length) {
		throw new Error(
			`AdMob runtime bundle contains unresolved imports: ${[
				...new Set(unsupportedImports),
			].join(", ")}`,
		);
	}

	if (!bundle.includes("showOptions") || !bundle.includes("gatherConsent")) {
		throw new Error("AdMob runtime bundle does not include the privacy API.");
	}

	return {
		bytes: Buffer.byteLength(bundle),
		imports: [...new Set(imports)],
	};
}

function main() {
	const rootDir = path.resolve(__dirname, "../..");
	const result = validateAdmobBundle({
		bundlePath: path.join(rootDir, "src/plugins/admob/www/admob.js"),
		pluginXmlPath: path.join(rootDir, "src/plugins/admob/plugin.xml"),
	});
	console.log(
		`AdMob bundle is valid (${result.bytes} bytes; imports: ${result.imports.join(", ")}).`,
	);
}

if (require.main === module) {
	try {
		main();
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}

module.exports = { validateAdmobBundle };

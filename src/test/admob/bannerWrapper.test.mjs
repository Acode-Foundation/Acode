import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { transformSync } from "@babel/core";
import test from "node:test";

function loadBannerModule() {
	const sourcePath = fileURLToPath(
		new URL("../../plugins/admob/src/www/ads/banner.ts", import.meta.url),
	);
	const source = readFileSync(sourcePath, "utf8");
	const { code } = transformSync(source, {
		filename: sourcePath,
		presets: [
			["@babel/preset-env", { modules: "commonjs", targets: { node: "current" } }],
			"@babel/preset-typescript",
		],
	});
	const calls = [];

	class MobileAd {
		constructor(options) {
			this.options = options;
		}

		async load() {
			calls.push("load");
		}

		async show() {
			calls.push("show");
			return "shown";
		}

		async hide() {
			calls.push("hide");
		}
	}

	const module = { exports: {} };
	const context = {
		console,
		cordova: { platformId: "android" },
		document: {
			createElement() {
				return {
					getContext() {
						return {};
					},
				};
			},
		},
		exports: module.exports,
		module,
		require(specifier) {
			if (specifier === "../common") {
				return {
					Platform: { ios: "ios" },
					execAsync() {
						throw new Error("Unexpected native configuration call");
					},
				};
			}
			if (specifier === "./base") {
				return { MobileAd };
			}
			throw new Error(`Unexpected module request: ${specifier}`);
		},
	};

	vm.runInNewContext(code, context, { filename: sourcePath });
	return { BannerAd: module.exports.BannerAd, calls };
}

test("every banner show uses the idempotent native load path", async () => {
	const { BannerAd, calls } = loadBannerModule();
	const banner = new BannerAd({ adUnitId: "test-banner" });

	assert.equal(await banner.show(), "shown");
	assert.equal(await banner.show(), "shown");
	assert.deepEqual(calls, ["load", "show", "load", "show"]);
});

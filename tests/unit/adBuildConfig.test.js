import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, expect, test, vi } from "vitest";

const require = createRequire(import.meta.url);
const { rspack } = require("@rspack/core");
const buildConfig = require("../../rspack.config.js");
const ads = require("../../ads.json");
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "acode-ad-config-"));
const entry = path.join(directory, "entry.js");

fs.writeFileSync(
	entry,
	`module.exports = {
	IS_IOS, IS_ANDROID, PLATFORM,
	appId: ADMOB_APP_ID,
	banner: ADMOB_BANNER_ID,
	interstitial: ADMOB_INTERSTITIAL_ID,
	rewarded: ADMOB_REWARDED_ID,
	appOpen: ADMOB_APP_OPEN_ID,
};`,
);

afterAll(() => fs.rmSync(directory, { recursive: true, force: true }));
afterEach(() => vi.unstubAllEnvs());

test.each([
	["ios", "development"],
	["ios", "production"],
	["android", "development"],
	["android", "production"],
])("%s %s compiles platform flags and IDs from ads.json", async (platform, mode) => {
	vi.stubEnv("ACODE_PLATFORM", platform);
	const [config] = buildConfig({}, { mode });
	const filename = `${platform}-${mode}.cjs`;
	const compiler = rspack({
		mode,
		devtool: false,
		entry,
		output: { path: directory, filename, library: { type: "commonjs2" } },
		plugins: config.plugins.filter(
			(plugin) => plugin instanceof rspack.DefinePlugin,
		),
	});
	await new Promise((resolve, reject) => {
		compiler.run((error, stats) =>
			compiler.close((closeError) => {
				if (error || closeError || stats.hasErrors()) {
					reject(error || closeError || new Error(stats.toString()));
				} else resolve();
			}),
		);
	});
	const ids = ads[platform][mode === "production" ? "production" : "test"];
	expect(require(path.join(directory, filename))).toEqual({
		IS_IOS: platform === "ios",
		IS_ANDROID: platform === "android",
		PLATFORM: platform,
		...ids,
	});
	const bundle = fs.readFileSync(path.join(directory, filename), "utf8");
	const otherPlatform = platform === "ios" ? "android" : "ios";
	for (const id of Object.values(ads[otherPlatform].production)) {
		expect(bundle).not.toContain(id);
	}
});

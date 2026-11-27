import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import { expect, test, vi } from "vitest";

const require = createRequire(import.meta.url);
const filename = path.resolve(import.meta.dirname, "../../dev/scripts/dev.js");
const source = fs.readFileSync(filename, "utf8");
const { getWebBundlePath } = require("../../dev/config.js");

test.each([
	"android",
	"ios",
])("%s dev server serves the selected platform bundle", (platform) => {
	const { api, readFile } = loadDevServer(platform);
	for (const [url, file, type] of [
		["/", "index.html", "text/html"],
		["/build/main.js?reload=1", "build/main.js", "application/javascript"],
		["/build/main.css", "build/main.css", "text/css"],
		[
			"/icons/ic_acode_default.svg",
			"icons/ic_acode_default.svg",
			"image/svg+xml",
		],
	]) {
		const response = { writeHead: vi.fn(), end: vi.fn() };
		api.handleRequest({ url }, response);
		expect(readFile).toHaveBeenLastCalledWith(
			path.join(getWebBundlePath(platform), file),
			expect.any(Function),
		);
		expect(response.writeHead).toHaveBeenLastCalledWith(
			200,
			expect.objectContaining({ "Content-Type": type }),
		);
		expect(response.end).toHaveBeenLastCalledWith("fixture");
	}
});

test.each([
	"android",
	"ios",
])("%s native watcher ignores generated bundles without ignoring native code", (platform) => {
	const { api, watch } = loadDevServer(platform);
	api.watchNative(platform, "simulator", false);
	const { ignored } = watch.mock.calls[0][1];
	expect(ignored(path.join(getWebBundlePath(platform), "build/main.js"))).toBe(
		true,
	);
	expect(
		ignored(path.resolve("platforms/ios/runner/WebViewController.swift")),
	).toBe(false);
	expect(
		ignored(
			path.resolve(
				"platforms/android/app/src/main/java/runner/MainActivity.java",
			),
		),
	).toBe(false);
});

function loadDevServer(platform) {
	const readFile = vi.fn((file, done) => done(null, "fixture"));
	const watch = vi.fn(() => ({ on: vi.fn() }));
	const module = { exports: {} };
	const scriptRequire = (name) => {
		if (name === "node:fs") return { ...fs, readFile };
		if (name === "chokidar") return { watch };
		if (name === "../config") return require("../../dev/config.js");
		return require(name);
	};
	vm.runInNewContext(
		`${source}\ncurrentOptions = { platform: ${JSON.stringify(platform)} }; module.exports = { handleRequest, watchNative };`,
		{
			require: scriptRequire,
			module,
			process,
			console,
			__dirname: path.dirname(filename),
		},
		{ filename },
	);
	return { api: module.exports, readFile, watch };
}

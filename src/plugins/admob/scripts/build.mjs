import commonjs from "@rollup/plugin-commonjs";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";
import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { rollup } from "rollup";

const run = promisify(execFile);
const external = ["cordova", "cordova/channel", "cordova/exec"];

await Promise.all([
	rm("www", { force: true, recursive: true }),
	rm("lib", { force: true, recursive: true }),
	rm("esm", { force: true, recursive: true }),
]);
await mkdir("www", { recursive: true });

const bundle = await rollup({
	input: "./src/www/admob.ts",
	external,
	plugins: [
		nodeResolve(),
		typescript({
			tsconfig: "./tsconfig.rollup.json",
			noForceEmit: true,
		}),
		commonjs(),
	],
});

try {
	await bundle.write({
		exports: "auto",
		file: "www/admob.js",
		format: "cjs",
		sourcemap: false,
	});
} finally {
	await bundle.close();
}

const runtimeBundle = await readFile("www/admob.js", "utf8");
await writeFile("www/admob.js", runtimeBundle.replace(/\r\n?/g, "\n"), "utf8");

const tsc = "./node_modules/typescript/bin/tsc";
await run(process.execPath, [
	tsc,
	"-p",
	"tsconfig.json",
	"--declaration",
	"--sourceMap",
	"--outDir",
	"lib",
]);
await run(process.execPath, [
	tsc,
	"-p",
	"tsconfig.json",
	"--declaration",
	"--sourceMap",
	"--outDir",
	"esm",
	"--module",
	"ES2022",
]);

// Rollup 3's plugin graph can retain handles under newer Node releases.
// Every output has been awaited, so terminate deterministically for CI.
process.exit(0);

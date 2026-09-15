#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
	cp,
	mkdir,
	mkdtemp,
	readFile,
	rename,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { build } = require("@marijn/buildtool");
const { lezer } = require("@lezer/generator/rollup");
const root = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../..",
);
const packages = ["codemirror-view", "codemirror-language"];
const buildOptions = {
	expandLink: (anchor) => `https://codemirror.net/6/docs/ref/#${anchor}`,
	pureTopCalls: true,
	outputPlugin: () => lezer(),
};

function run(command, args, cwd, env = {}) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd,
			env: { ...process.env, ...env },
			stdio: "inherit",
		});
		child.once("error", reject);
		child.once("exit", (code, signal) => {
			if (code === 0) resolve();
			else reject(new Error(`${command} exited with ${signal || code}`));
		});
	});
}

function shouldCopyPackageFile(packageRoot, source) {
	const relative = path.relative(packageRoot, source);
	if (!relative) return true;
	if (relative === "dist" || relative.startsWith(`dist${path.sep}`))
		return false;
	if (
		relative.startsWith(`test${path.sep}`) &&
		path.extname(relative) !== ".ts"
	) {
		return false;
	}
	return true;
}

async function replaceDirectory(source, target) {
	const staging = `${target}.next-${process.pid}`;
	const backup = `${target}.previous-${process.pid}`;
	await rm(staging, { recursive: true, force: true });
	await rm(backup, { recursive: true, force: true });
	await cp(source, staging, { recursive: true });

	let hadTarget = true;
	try {
		await rename(target, backup);
	} catch (error) {
		if (error?.code !== "ENOENT") throw error;
		hadTarget = false;
	}

	try {
		await rename(staging, target);
	} catch (error) {
		if (hadTarget) await rename(backup, target);
		throw error;
	}
	if (hadTarget) await rm(backup, { recursive: true, force: true });
}

async function replaceFile(source, target) {
	const staging = `${target}.next-${process.pid}`;
	await rm(staging, { force: true });
	await cp(source, staging);
	await rename(staging, target);
}

const temporaryRoot = await mkdtemp(
	path.join(os.tmpdir(), "acode-codemirror-vendor-"),
);
const temporaryPackages = path.join(temporaryRoot, "packages");

try {
	await mkdir(temporaryPackages, { recursive: true });
	await symlink(
		path.join(root, "node_modules"),
		path.join(temporaryRoot, "node_modules"),
		process.platform === "win32" ? "junction" : "dir",
	);
	const builtPackages = [];

	for (const packageName of packages) {
		const packageRoot = path.join(root, "vendor", packageName);
		const temporaryPackageRoot = path.join(temporaryRoot, packageName);
		await cp(packageRoot, temporaryPackageRoot, {
			recursive: true,
			filter: (source) => shouldCopyPackageFile(packageRoot, source),
		});
		const entry = path.join(temporaryPackageRoot, "src", "index.ts");
		if (!(await build(entry, buildOptions))) {
			throw new Error(`Failed to build ${packageName}`);
		}
		const manifest = JSON.parse(
			await readFile(path.join(temporaryPackageRoot, "package.json"), "utf8"),
		);
		builtPackages.push({
			packageName,
			packageRoot,
			temporaryPackageRoot,
			archiveName: `${manifest.name.replace("@", "").replace("/", "-")}-${manifest.version}.tgz`,
		});
	}

	for (const builtPackage of builtPackages) {
		await run(
			"npm",
			[
				"pack",
				builtPackage.temporaryPackageRoot,
				"--ignore-scripts",
				"--pack-destination",
				temporaryPackages,
			],
			root,
			{ npm_config_cache: path.join(temporaryRoot, "npm-cache") },
		);
		const packed = path.join(temporaryPackages, builtPackage.archiveName);
		const hash = createHash("sha256")
			.update(await readFile(packed))
			.digest("hex")
			.slice(0, 16);
		builtPackage.fingerprintedArchive = builtPackage.archiveName.replace(
			/\.tgz$/,
			`-acode.${hash}.tgz`,
		);
		await rename(
			packed,
			path.join(temporaryPackages, builtPackage.fingerprintedArchive),
		);
	}

	for (const builtPackage of builtPackages) {
		await replaceDirectory(
			path.join(builtPackage.temporaryPackageRoot, "dist"),
			path.join(builtPackage.packageRoot, "dist"),
		);
	}
	const manifestPath = path.join(root, "package.json");
	const appManifest = JSON.parse(await readFile(manifestPath, "utf8"));
	for (const builtPackage of builtPackages) {
		await replaceFile(
			path.join(temporaryPackages, builtPackage.fingerprintedArchive),
			path.join(root, "vendor", "packages", builtPackage.fingerprintedArchive),
		);
		const name = builtPackage.packageName.replace(
			"codemirror-",
			"@codemirror/",
		);
		appManifest.dependencies[name] =
			`file:vendor/packages/${builtPackage.fingerprintedArchive}`;
	}
	// A new filename forces npm to replace a previously installed archive even
	// when the upstream version stays the same. Reinstall to update the lockfile.
	await writeFile(
		`${manifestPath}.next`,
		`${JSON.stringify(appManifest, null, 2)}\n`,
	);
	await rename(`${manifestPath}.next`, manifestPath);
} finally {
	await rm(temporaryRoot, { recursive: true, force: true });
}

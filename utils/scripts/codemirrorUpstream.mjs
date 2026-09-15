#!/usr/bin/env node

// Work only in disposable copies; never reset or modify the upstream checkout.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const [mode, name, upstreamPath] = process.argv.slice(2);
if (
	!["check", "refresh", "upgrade"].includes(mode) ||
	!["view", "language"].includes(name) ||
	!upstreamPath
) {
	throw new Error(
		"Usage: node utils/scripts/codemirrorUpstream.mjs <check|refresh|upgrade> <view|language> <upstream-checkout>",
	);
}

const upstream = path.resolve(upstreamPath);
const vendor = path.join(root, "vendor", `codemirror-${name}`);
const patchFile = path.join(root, "vendor", "patches", `${name}.patch`);
const metadataFile = path.join(root, "vendor", "upstream.json");
const metadata = JSON.parse(fs.readFileSync(metadataFile, "utf8"));
const baseline = metadata[name];
const sourceFiles = [
	"src",
	"test",
	"LICENSE",
	"README.md",
	"CHANGELOG.md",
	"package.json",
];

function git(cwd, ...args) {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		maxBuffer: 16 * 1024 * 1024,
	});
}

function copySource(from, to) {
	for (const file of sourceFiles) {
		fs.cpSync(path.join(from, file), path.join(to, file), { recursive: true });
	}
}

function packageManifest(directory) {
	return JSON.parse(
		fs.readFileSync(path.join(directory, "package.json"), "utf8"),
	);
}

function writeJSON(file, value) {
	fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function initialize(directory) {
	git(directory, "init", "--quiet");
	git(directory, "add", ".");
}

function snapshot(directory) {
	const result = new Map();
	function visit(relative) {
		const file = path.join(directory, relative);
		const stat = fs.lstatSync(file);
		if (stat.isSymbolicLink()) throw new Error(`Unexpected symlink: ${file}`);
		if (stat.isDirectory()) {
			for (const child of fs.readdirSync(file).sort())
				visit(path.join(relative, child));
		} else {
			result.set(relative, fs.readFileSync(file));
		}
	}
	for (const file of sourceFiles) visit(file);
	return result;
}

const commit = git(upstream, "rev-parse", "HEAD").trim();
if (git(upstream, "status", "--porcelain", "--untracked-files=all").trim()) {
	throw new Error("Use a clean upstream checkout, including untracked files.");
}
const manifest = packageManifest(upstream);
if (manifest.name !== `@codemirror/${name}`)
	throw new Error("Wrong upstream package.");
if (
	mode !== "upgrade" &&
	(commit !== baseline.commit || manifest.version !== baseline.version)
) {
	throw new Error(
		`Expected ${baseline.version} at ${baseline.commit}; found ${manifest.version} at ${commit}.`,
	);
}
// Refuse an upgrade that would silently discard edits not saved in the patch.
if (mode === "upgrade") {
	const expected = JSON.parse(
		fs.readFileSync(
			path.join(root, "vendor", "patches", `${name}.source.json`),
			"utf8",
		),
	);
	const { createHash } = await import("node:crypto");
	const actual = Object.fromEntries(
		[...snapshot(vendor)].map(([file, data]) => [
			file,
			createHash("sha256").update(data).digest("hex"),
		]),
	);
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(
			"Vendored source has changed. Run refresh against the old upstream revision before upgrading.",
		);
	}
}

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "acode-cm-patch-"));
try {
	copySource(upstream, temporary);
	initialize(temporary);
	if (mode === "refresh") {
		// Index contains pristine upstream. Working tree becomes the local source.
		for (const file of sourceFiles)
			fs.rmSync(path.join(temporary, file), { recursive: true, force: true });
		copySource(vendor, temporary);
		git(temporary, "add", "--intent-to-add", ".");
		const patch = git(
			temporary,
			"diff",
			"--binary",
			"--no-ext-diff",
			"--no-renames",
		);
		fs.mkdirSync(path.dirname(patchFile), { recursive: true });
		fs.writeFileSync(patchFile, patch);
	} else {
		// Check every hunk before applying anything. No fuzzy string replacement.
		git(temporary, "apply", "--check", patchFile);
		git(temporary, "apply", patchFile);
		if (mode === "check") {
			const local = snapshot(vendor),
				replayed = snapshot(temporary);
			const files = new Set([...local.keys(), ...replayed.keys()]);
			const changed = [...files].filter(
				(file) =>
					!local.has(file) ||
					!replayed.has(file) ||
					!local.get(file).equals(replayed.get(file)),
			);
			if (changed.length)
				throw new Error(`Patch/source drift: ${changed.join(", ")}`);
		} else {
			// All validation succeeded in the disposable directory before mutation.
			for (const file of sourceFiles) {
				fs.rmSync(path.join(vendor, file), { recursive: true, force: true });
				fs.cpSync(path.join(temporary, file), path.join(vendor, file), {
					recursive: true,
				});
			}
			metadata[name] = { ...baseline, version: manifest.version, commit };
			writeJSON(metadataFile, metadata);
			fs.writeFileSync(
				path.join(vendor, "UPSTREAM.md"),
				`# Upstream revision\n\n- Package: \`@codemirror/${name}\` ${manifest.version}\n- Repository: ${baseline.repository}\n- Commit: \`${commit}\`\n`,
			);
			const appFile = path.join(root, "package.json");
			const app = packageManifest(root);
			app.dependencies[manifest.name] =
				`file:vendor/packages/codemirror-${name}-${manifest.version}.tgz`;
			writeJSON(appFile, app);
			// Regenerate patch context against this upstream revision.
			git(temporary, "add", "--intent-to-add", ".");
			fs.writeFileSync(
				patchFile,
				git(temporary, "diff", "--binary", "--no-ext-diff", "--no-renames"),
			);
		}
	}
	if (mode !== "check") {
		const { createHash } = await import("node:crypto");
		writeJSON(
			path.join(root, "vendor", "patches", `${name}.source.json`),
			Object.fromEntries(
				[...snapshot(vendor)].map(([file, data]) => [
					file,
					createHash("sha256").update(data).digest("hex"),
				]),
			),
		);
	}
	console.log(`${name}: ${mode} passed (${manifest.version}, ${commit}).`);
	if (mode === "upgrade")
		console.log(
			"Next: build:codemirror-vendor, reinstall the local archives, then run CodeMirror tests and Android benchmarks. Remove superseded archives after validation.",
		);
} finally {
	fs.rmSync(temporary, { recursive: true, force: true });
}

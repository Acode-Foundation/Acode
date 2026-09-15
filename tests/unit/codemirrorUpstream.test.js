import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const temporaryRoots = [];
afterEach(() => {
	for (const root of temporaryRoots.splice(0))
		fs.rmSync(root, { recursive: true, force: true });
});

function fixture() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "acode-upstream-test-"));
	temporaryRoots.push(root);
	const upstream = path.join(root, "upstream");
	const vendor = path.join(root, "vendor", "codemirror-view");
	const script = path.join(root, "utils", "scripts", "codemirrorUpstream.mjs");
	fs.mkdirSync(path.dirname(script), { recursive: true });
	fs.copyFileSync(
		new URL("../../utils/scripts/codemirrorUpstream.mjs", import.meta.url),
		script,
	);
	fs.mkdirSync(path.join(upstream, "src"), { recursive: true });
	fs.mkdirSync(path.join(upstream, "test"));
	fs.writeFileSync(
		path.join(upstream, "src", "index.ts"),
		"export const value = 1;\n",
	);
	for (const file of ["LICENSE", "README.md", "CHANGELOG.md"])
		fs.writeFileSync(path.join(upstream, file), file);
	const manifest = {
		name: "@codemirror/view",
		version: "6.0.0",
		files: ["dist"],
	};
	fs.writeFileSync(
		path.join(upstream, "package.json"),
		JSON.stringify(manifest),
	);
	function git(...args) {
		return execFileSync("git", args, {
			cwd: upstream,
			encoding: "utf8",
		}).trim();
	}
	function commit() {
		git("add", ".");
		git(
			"-c",
			"user.name=Test",
			"-c",
			"user.email=test@example.test",
			"-c",
			"commit.gpgsign=false",
			"commit",
			"--quiet",
			"-m",
			"fixture",
		);
		return git("rev-parse", "HEAD");
	}
	git("init", "--quiet");
	const baseline = commit();
	fs.mkdirSync(vendor, { recursive: true });
	for (const file of [
		"src",
		"test",
		"LICENSE",
		"README.md",
		"CHANGELOG.md",
		"package.json",
	]) {
		fs.cpSync(path.join(upstream, file), path.join(vendor, file), {
			recursive: true,
		});
	}
	fs.writeFileSync(
		path.join(vendor, "src", "index.ts"),
		"export const value = 2;\n",
	);
	fs.writeFileSync(
		path.join(vendor, "src", "mobile.ts"),
		"export const mobile = true;\n",
	);
	fs.writeFileSync(
		path.join(root, "vendor", "upstream.json"),
		JSON.stringify({
			view: {
				version: "6.0.0",
				commit: baseline,
				repository: "https://example.test/view.git",
			},
		}),
	);
	fs.writeFileSync(
		path.join(root, "package.json"),
		JSON.stringify({ dependencies: { "@codemirror/view": "file:old.tgz" } }),
	);
	function run(mode) {
		return spawnSync(process.execPath, [script, mode, "view", upstream], {
			encoding: "utf8",
		});
	}
	function upgrade(conflict = false) {
		manifest.version = "6.0.1";
		fs.writeFileSync(
			path.join(upstream, "package.json"),
			JSON.stringify(manifest),
		);
		if (conflict)
			fs.writeFileSync(
				path.join(upstream, "src", "index.ts"),
				"export const value = 3;\n",
			);
		else
			fs.writeFileSync(
				path.join(upstream, "src", "upstream.ts"),
				"export const upstream = true;\n",
			);
		return commit();
	}
	return { root, vendor, upstream, run, upgrade };
}

describe("CodeMirror upstream patch workflow", () => {
	it("replays edits and added files exactly and detects source drift", () => {
		const f = fixture();
		expect(f.run("refresh").status).toBe(0);
		expect(f.run("check").status).toBe(0);
		fs.appendFileSync(path.join(f.vendor, "src", "index.ts"), "// drift\n");
		expect(f.run("check").stderr).toContain("Patch/source drift");
	});

	it("upgrades in a disposable copy while retaining both upstream and local additions", () => {
		const f = fixture();
		expect(f.run("refresh").status).toBe(0);
		const commit = f.upgrade();
		const result = f.run("upgrade");
		expect(result.stderr).toBe("");
		expect(result.status).toBe(0);
		expect(
			fs.readFileSync(path.join(f.vendor, "src", "index.ts"), "utf8"),
		).toContain("value = 2");
		expect(fs.existsSync(path.join(f.vendor, "src", "upstream.ts"))).toBe(true);
		expect(fs.existsSync(path.join(f.vendor, "src", "mobile.ts"))).toBe(true);
		const metadata = JSON.parse(
			fs.readFileSync(path.join(f.root, "vendor", "upstream.json"), "utf8"),
		);
		expect(metadata.view.commit).toBe(commit);
		expect(metadata.view.version).toBe("6.0.1");
		expect(f.run("check").status).toBe(0);
	});

	it("leaves source and metadata intact if the new upstream conflicts", () => {
		const f = fixture();
		expect(f.run("refresh").status).toBe(0);
		const metadataFile = path.join(f.root, "vendor", "upstream.json");
		const metadata = fs.readFileSync(metadataFile, "utf8");
		f.upgrade(true);
		expect(f.run("upgrade").status).not.toBe(0);
		expect(fs.readFileSync(metadataFile, "utf8")).toBe(metadata);
		expect(
			fs.readFileSync(path.join(f.vendor, "src", "index.ts"), "utf8"),
		).toContain("value = 2");
	});

	it("refuses to discard local edits or use a dirty upstream checkout", () => {
		const f = fixture();
		expect(f.run("refresh").status).toBe(0);
		f.upgrade();
		fs.appendFileSync(path.join(f.vendor, "src", "mobile.ts"), "// unsaved\n");
		expect(f.run("upgrade").stderr).toContain("Vendored source has changed");
		fs.writeFileSync(
			path.join(f.upstream, "untracked.txt"),
			"work in progress",
		);
		expect(f.run("upgrade").stderr).toContain("clean upstream checkout");
	});
});

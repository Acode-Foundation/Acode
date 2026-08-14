import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("fileSystem", () => ({ default: vi.fn() }));

import { TerminalStorageService } from "lib/terminalStorage";

const execFileAsync = promisify(execFile);
const temporaryRoots = [];

function fromFileUrl(url) {
	return decodeURIComponent(new URL(url).pathname);
}

function createNodeFsFactory() {
	return (url) => {
		const target = fromFileUrl(url);
		return {
			async exists() {
				try {
					await fs.lstat(target);
					return true;
				} catch {
					return false;
				}
			},
			async lsDir() {
				return (await fs.readdir(target)).map((name) => ({ name }));
			},
			async createDirectory(name) {
				const child = path.join(target, name);
				await fs.mkdir(child);
				return pathToFileURL(child).href.replace(/\/$/, "");
			},
			async createFile(name, content) {
				const child = path.join(target, name);
				await fs.writeFile(child, content);
				return pathToFileURL(child).href;
			},
		};
	};
}

async function inventory(root) {
	const records = [];
	async function visit(directory, relative = "") {
		for (const name of await fs.readdir(directory)) {
			const absolute = path.join(directory, name);
			const childRelative = path.join(relative, name);
			const stat = await fs.lstat(absolute);
			if (stat.isSymbolicLink()) {
				records.push(`link|${childRelative}|${await fs.readlink(absolute)}`);
			} else if (stat.isDirectory()) {
				records.push(`dir|${childRelative}`);
				await visit(absolute, childRelative);
			} else {
				records.push(`file|${childRelative}|${stat.size}`);
			}
		}
	}
	await visit(root);
	records.sort();
	return {
		count: records.length,
		hash: createHash("sha256").update(records.join("\n")).digest("hex"),
	};
}

afterEach(async () => {
	await Promise.all(
		temporaryRoots.splice(0).map((root) =>
			fs.rm(root, { recursive: true, force: true }),
		),
	);
});

describe("v1.11 terminal storage upgrade", () => {
	it("recovers complete trees without merging or changing legacy sources", async () => {
		const filesDir = await fs.mkdtemp(path.join(os.tmpdir(), "acode-recovery-"));
		temporaryRoots.push(filesDir);
		const legacyHome = path.join(filesDir, "alpine", "home");
		const legacyRoot = path.join(filesDir, "alpine", "root");
		const publicDir = path.join(filesDir, "public");
		await fs.mkdir(path.join(legacyHome, "project with spaces"), {
			recursive: true,
		});
		await fs.mkdir(path.join(legacyRoot, "project"), { recursive: true });
		await fs.mkdir(path.join(publicDir, "project"), { recursive: true });
		await fs.writeFile(path.join(legacyHome, ".profile"), "legacy hidden");
		await fs.writeFile(
			path.join(legacyHome, "project with spaces", "index.js"),
			"legacy home",
		);
		await fs.writeFile(path.join(legacyRoot, "project", "index.js"), "legacy root");
		await fs.writeFile(path.join(publicDir, "project", "index.js"), "current public");
		await fs.symlink(
			"project with spaces/index.js",
			path.join(legacyHome, "index-link"),
		);
		const homeBefore = await inventory(legacyHome);
		const rootBefore = await inventory(legacyRoot);

		const service = new TerminalStorageService({
			getFilesDir: async () => filesDir,
			fsFactory: createNodeFsFactory(),
			getExecutor: () => ({
				async execute(command) {
					const { stdout } = await execFileAsync("sh", ["-c", command]);
					return stdout.trim();
				},
			}),
			getTerminal: () => ({ isAxsRunning: async () => false }),
			now: () => new Date(2026, 7, 14, 9, 8, 7),
		});
		service.getInventory = inventory;

		const result = await service.importCopies();
		const recoveredHome = result.destinations.home.destination;
		const recoveredRoot = result.destinations.root.destination;

		expect(result.verified).toBe(true);
		expect(recoveredHome).not.toContain("%20");
		expect(await fs.readFile(path.join(recoveredHome, ".profile"), "utf8")).toBe(
			"legacy hidden",
		);
		expect(
			await fs.readFile(
				path.join(recoveredHome, "project with spaces", "index.js"),
				"utf8",
			),
		).toBe("legacy home");
		expect((await fs.lstat(path.join(recoveredHome, "index-link"))).isSymbolicLink()).toBe(
			true,
		);
		expect(await fs.readFile(path.join(recoveredRoot, "project", "index.js"), "utf8")).toBe(
			"legacy root",
		);
		expect(await fs.readFile(path.join(publicDir, "project", "index.js"), "utf8")).toBe(
			"current public",
		);
		expect(await inventory(legacyHome)).toEqual(homeBefore);
		expect(await inventory(legacyRoot)).toEqual(rootBefore);
	});
});

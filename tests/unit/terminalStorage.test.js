import { describe, expect, it, vi } from "vitest";

vi.mock("fileSystem", () => ({ default: vi.fn() }));

import {
	buildRecoveryFolderName,
	TerminalStorageService,
} from "lib/terminalStorage";

const fixedDate = new Date(2026, 7, 14, 9, 8, 7);

function createService({ copyFails = false } = {}) {
	const entries = new Map([
		["file:///files/alpine/home", ["project", ".profile"]],
		["file:///files/alpine/root", []],
		["file:///files/public", []],
	]);
	const created = [];
	const deleted = vi.fn();
	const fsFactory = (url) => ({
		async exists() {
			return entries.has(url);
		},
		async lsDir() {
			return (entries.get(url) || []).map((name) => ({ name }));
		},
		async createDirectory(name) {
			const child = `${url}/${name}`;
			entries.set(child, []);
			created.push(child);
			return child;
		},
		async createFile(name, content) {
			created.push(`${url}/${name}`);
			return `${url}/${name}`;
		},
		delete: deleted,
	});
	const executor = {
		execute: vi.fn(async (command) => {
			if (command.startsWith("cp ") && copyFails) {
				throw new Error("copy failed");
			}
			return "";
		}),
	};
	const terminal = {
		isAxsRunning: vi.fn(async () => true),
		stopAxs: vi.fn(async () => {}),
	};
	const service = new TerminalStorageService({
		getFilesDir: async () => "/files",
		fsFactory,
		getExecutor: () => executor,
		getTerminal: () => terminal,
		now: () => fixedDate,
	});
	service.getInventory = vi.fn(async (path) => ({
		hash: "same-inventory",
		count: path.includes("Recovered") && copyFails ? 0 : 2,
	}));
	return { service, created, deleted, entries, terminal };
}

describe("legacy terminal storage recovery", () => {
	it("creates deterministic collision-safe recovery names", () => {
		expect(buildRecoveryFolderName("home", fixedDate)).toBe(
			"Recovered Home 2026-08-14 09-08-07",
		);
		expect(buildRecoveryFolderName("home", fixedDate, 1)).toBe(
			"Recovered Home 2026-08-14 09-08-07 (2)",
		);
	});

	it("copies and verifies legacy data without deleting the source", async () => {
		const { service, deleted, terminal } = createService();
		const result = await service.importCopies();

		expect(result.verified).toBe(true);
		expect(result.destinations.home.destination).toContain("Recovered Home");
		expect(result.manifestUrl).toContain(".acode-legacy-recovery-");
		expect(terminal.stopAxs).toHaveBeenCalledTimes(1);
		expect(deleted).not.toHaveBeenCalled();
	});

	it("uses a new recovery folder when the timestamped name already exists", async () => {
		const { service, entries } = createService();
		entries.set(
			"file:///files/public/Recovered Home 2026-08-14 09-08-07",
			[],
		);
		const result = await service.importCopies();
		expect(result.destinations.home.destination).toContain(
			"Recovered Home 2026-08-14 09-08-07 (2)",
		);
	});

	it("reports incomplete imports while preserving originals", async () => {
		const { service, deleted } = createService({ copyFails: true });
		const result = await service.importCopies();

		expect(result.verified).toBe(false);
		expect(result.errors).toHaveLength(1);
		expect(result.skipped).toBe(2);
		expect(deleted).not.toHaveBeenCalled();
	});
});

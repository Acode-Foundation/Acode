import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	cleanupEditorFixture,
	editorFixtureCleanupExpression,
	installBenchmarkInterruptRecovery,
	reportBenchmarkRecovery,
} from "../../utils/benchmarks/editorFixtures.mjs";

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("editor benchmark fixture cleanup", () => {
	it("restores the previous file, removes the fixture, and is idempotent", async () => {
		const previousFile = { makeActive: vi.fn() };
		const file = { remove: vi.fn().mockResolvedValue(undefined) };
		const editorManager = { files: [previousFile, file] };
		const benchmark = { previousFile, file };

		await expect(cleanupEditorFixture(benchmark, editorManager)).resolves.toBe(true);
		expect(previousFile.makeActive).toHaveBeenCalledOnce();
		expect(file.remove).toHaveBeenCalledWith(true, {
			ignorePinned: true,
			suppressPanePlaceholder: true,
		});

		editorManager.files = [previousFile];
		await expect(cleanupEditorFixture(benchmark, editorManager)).resolves.toBe(true);
		expect(file.remove).toHaveBeenCalledOnce();
	});

	it("handles missing and partially initialized fixtures", async () => {
		await expect(cleanupEditorFixture(null, null)).resolves.toBe(false);
		await expect(
			cleanupEditorFixture({ previousFile: null, file: null }, { files: [] }),
		).resolves.toBe(true);
	});

	it("still removes the fixture when restoring the previous file fails", async () => {
		const restoreError = new Error("restore failed");
		const previousFile = {
			makeActive: vi.fn(() => {
				throw restoreError;
			}),
		};
		const file = { remove: vi.fn().mockResolvedValue(undefined) };
		const editorManager = { files: [previousFile, file] };

		await expect(
			cleanupEditorFixture({ previousFile, file }, editorManager),
		).rejects.toThrow("restore failed");
		expect(file.remove).toHaveBeenCalledOnce();
	});

	it("clears benchmark globals even when fixture removal fails", async () => {
		const cleanupError = new Error("remove failed");
		vi.stubGlobal("window", {
			editorManager: { files: [] },
			__benchmark: { file: { remove: vi.fn().mockRejectedValue(cleanupError) } },
			__samples: [1],
		});
		window.editorManager.files.push(window.__benchmark.file);

		const expression = editorFixtureCleanupExpression("__benchmark", ["__samples"]);
		await expect(Function(`return ${expression}`)()).rejects.toThrow("remove failed");
		expect(window).not.toHaveProperty("__benchmark");
		expect(window).not.toHaveProperty("__samples");
	});

	it("reports cleanup failures without replacing an existing benchmark error", () => {
		const benchmarkError = new Error("benchmark failed");
		const cleanupError = new Error("cleanup failed");
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

		expect(() => reportBenchmarkRecovery(benchmarkError, [cleanupError])).not.toThrow();
		expect(consoleError).toHaveBeenCalledWith(
			"Benchmark recovery failed:",
			cleanupError,
		);
		expect(() => reportBenchmarkRecovery(null, [cleanupError])).toThrow(AggregateError);
	});

	it("runs recovery before re-emitting an interrupt signal", async () => {
		const processTarget = new EventEmitter();
		processTarget.pid = 123;
		processTarget.kill = vi.fn();
		const recover = vi.fn().mockResolvedValue(undefined);
		installBenchmarkInterruptRecovery(recover, processTarget);

		processTarget.emit("SIGINT");
		await vi.waitFor(() => expect(processTarget.kill).toHaveBeenCalledOnce());
		expect(recover).toHaveBeenCalledWith("SIGINT");
		expect(processTarget.kill).toHaveBeenCalledWith(123, "SIGINT");
		expect(processTarget.listenerCount("SIGTERM")).toBe(0);
	});
});

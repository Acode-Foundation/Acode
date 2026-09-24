import { expect, it, vi } from "vitest";
import { loadSourceModule } from "../helpers/loadSourceModule";

function setup() {
	const run = vi.fn();
	const editorManager = { activeFile: { id: "requested" } };
	const { default: runLazily } = loadSourceModule(
		"src/lib/runLazily.js",
		{ "./run": { __esModule: true, default: run } },
		{ editorManager },
	);
	return { run, editorManager, runLazily };
}

it("runs the file that was active when the run was requested", async () => {
	const { run, editorManager, runLazily } = setup();

	const pending = runLazily(false, "inapp", true);
	// The user switches tabs while the runner chunk is still loading.
	editorManager.activeFile = { id: "switched" };
	await pending;

	expect(run).toHaveBeenCalledExactlyOnceWith(false, "inapp", true, {
		id: "requested",
	});
});

it("does not capture a file for the console", async () => {
	const { run, runLazily } = setup();

	await runLazily(true, "inapp");

	expect(run).toHaveBeenCalledExactlyOnceWith(true, "inapp", undefined, null);
});

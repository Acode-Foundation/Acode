import { readFileSync } from "node:fs";
import vm from "node:vm";
import { expect, it, vi } from "vitest";

const source = readFileSync(
	new URL("../../src/sidebarApps/searchInFiles/index.js", import.meta.url),
	"utf8",
);
function extract(name, next) {
	return source.slice(
		source.indexOf(`async function ${name}(`),
		source.indexOf(`\n${next}`, source.indexOf(`async function ${name}(`)),
	);
}
it("waits for discovery before subscribing to file events or taking the search snapshot", async () => {
	let resolve;
	const ready = new Promise((r) => {
		resolve = r;
	});
	const addEvents = vi.fn();
	const files = vi.fn(() => []);
	const context = vm.createContext({
		$search: { value: "needle" },
		getOptions: () => ({}),
		toRegex: () => /needle/g,
		searchVersion: 1,
		waitForFileList: () => ready,
		addEvents,
		files,
		helpers: { isBinary: () => false },
		addedFolder: [],
		editorManager: { files: [] },
		searchResult: { setGhostText() {} },
		strings: {},
		$progress: {},
		$indexStatus: {},
		TIMEOUT: Symbol(),
		FILE_LIST_WAIT_TIMEOUT: 250,
		withTimeout: async () => context.TIMEOUT,
	});
	vm.runInContext(
		extract("searchAll", "async function readSearchFileContent") +
			extract("waitForFileListIfReady", "function markIndexDirty"),
		context,
	);
	const pending = vm.runInContext("searchAll()", context);
	await new Promise((resolve) => setImmediate(resolve));
	expect(addEvents).not.toHaveBeenCalled();
	expect(files).not.toHaveBeenCalled();
	expect(context.$indexStatus.value).toBe("Scanning project files...");
	resolve();
	await pending;
	expect(addEvents).toHaveBeenCalledTimes(1);
	expect(files).toHaveBeenCalledTimes(1);
});

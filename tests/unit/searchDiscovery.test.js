import { readFileSync } from "node:fs";
import vm from "node:vm";
import { afterEach, expect, it, vi } from "vitest";

const source = readFileSync(
	new URL("../../src/sidebarApps/searchInFiles/index.js", import.meta.url),
	"utf8",
);
function extract(start, end) {
	const offset = source.indexOf(start);
	return source.slice(offset, source.indexOf(end, offset));
}
function setup() {
	vi.useFakeTimers();
	let resolve;
	const ready = new Promise((r) => {
		resolve = r;
	});
	const context = vm.createContext({
		$search: { value: "needle" },
		getOptions: () => ({}),
		toRegex: () => /needle/g,
		searchVersion: 1,
		pendingDiscoveryVersion: null,
		waitForFileList: () => ready,
		addEvents: vi.fn(),
		files: vi.fn(() => [{ url: "github://test/a.js" }]),
		helpers: { isBinary: () => false },
		addedFolder: [],
		editorManager: { files: [] },
		searchResult: { setGhostText() {} },
		strings: {},
		$progress: {},
		$indexStatus: {},
		$error: {},
		TIMEOUT: Symbol(),
		FILE_LIST_WAIT_TIMEOUT: 250,
		FILE_LIST_MAX_WAIT: 5000,
		setTimeout,
		clearTimeout,
		words: [],
		fileNames: [],
		supportsNativeSearch: () => false,
		sendMessage: vi.fn(),
		onFileUpdate: vi.fn(),
	});
	vm.runInContext(
		extract(
			"async function searchAll(",
			"async function readSearchFileContent",
		) +
			extract(
				"async function waitForFileListIfReady(",
				"function markIndexDirty",
			) +
			extract("function withTimeout(", "\n/**") +
			extract("function onFileAdded(", "function onFileUpdate("),
		context,
	);
	return { context, resolve, pending: vm.runInContext("searchAll()", context) };
}
afterEach(() => vi.useRealTimers());
it("waits for discovery before subscribing or taking the search snapshot", async () => {
	const { context, resolve, pending } = setup();
	await vi.advanceTimersByTimeAsync(250);
	expect(context.addEvents).not.toHaveBeenCalled();
	expect(context.files).not.toHaveBeenCalled();
	expect(context.$indexStatus.value).toBe("Scanning project files...");
	resolve();
	await pending;
	expect(context.addEvents).toHaveBeenCalledTimes(1);
	expect(context.sendMessage).toHaveBeenCalledTimes(1);
	expect(context.pendingDiscoveryVersion).toBeNull();
});
it("starts snapshot search after five seconds and suppresses discovery restarts", async () => {
	const { context, resolve, pending } = setup();
	await vi.advanceTimersByTimeAsync(5000);
	await pending;
	expect(context.sendMessage).toHaveBeenCalledTimes(1);
	expect(context.$error.value).toContain("incomplete");
	vm.runInContext('onFileAdded({ url: "github://test/new.js" })', context);
	expect(context.onFileUpdate).not.toHaveBeenCalled();
	resolve();
	await vi.advanceTimersByTimeAsync(0);
	expect(context.$error.value).toContain("search again");
	expect(context.sendMessage).toHaveBeenCalledTimes(1);
	vm.runInContext('onFileAdded({ url: "github://test/manual.js" })', context);
	expect(context.onFileUpdate).toHaveBeenCalledTimes(1);
});
it("does not start a stale search when the query changes during discovery", async () => {
	const { context, pending } = setup();
	await vi.advanceTimersByTimeAsync(250);
	context.searchVersion = 2;
	await vi.advanceTimersByTimeAsync(4750);
	await pending;
	expect(context.sendMessage).not.toHaveBeenCalled();
});
it("ignores late readiness from a superseded query", async () => {
	const { context, resolve, pending } = setup();
	await vi.advanceTimersByTimeAsync(5000);
	await pending;
	context.searchVersion = 2;
	context.pendingDiscoveryVersion = 2;
	context.$error.value = "new query";
	resolve();
	await vi.advanceTimersByTimeAsync(0);
	expect(context.$error.value).toBe("new query");
	expect(context.pendingDiscoveryVersion).toBe(2);
});

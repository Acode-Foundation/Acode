import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

const source = readFileSync(
	`${process.cwd()}/src/sidebarApps/searchInFiles/index.js`,
	"utf8",
);

function createReplaceAll({ search, replace, native = false }) {
	const context = vm.createContext({
		$search: { value: search },
		$replace: { value: replace },
		filesSearched: [{ url: "file:///a.js" }, { url: "file:///b.js" }],
		filesReplaced: [],
		replacing: false,
		activeReplaceTasks: 0,
		terminateWorker: vi.fn(),
		getOptions: () => ({ regExp: false }),
		toRegex: (value) => new RegExp(value, "g"),
		supportsNativeSearch: () => native,
		sendNativeSearch: vi.fn(),
		sendMessage: vi.fn(),
	});
	vm.runInContext(
		source.slice(
			source.indexOf("async function replaceAll()"),
			source.indexOf("function sendMessage("),
		),
		context,
	);
	return context;
}

describe("search in files replace all", () => {
	it("replaces matches with an empty string", async () => {
		const context = createReplaceAll({ search: "foo", replace: "" });
		await vm.runInContext("replaceAll()", context);

		expect(context.sendMessage).toHaveBeenCalledTimes(1);
		const [action, files, , , replace] = context.sendMessage.mock.calls[0];
		expect(action).toBe("replace-files");
		expect(files).toHaveLength(2);
		expect(replace).toBe("");
		expect(context.replacing).toBe(true);
	});

	it("sends an empty replacement to the native search", async () => {
		const context = createReplaceAll({
			search: "foo",
			replace: "",
			native: true,
		});
		await vm.runInContext("replaceAll()", context);

		expect(context.sendNativeSearch).toHaveBeenCalledTimes(1);
		expect(context.sendNativeSearch.mock.calls[0][0]).toBe("replace");
		expect(context.sendNativeSearch.mock.calls[0][4]).toBe("");
		expect(context.sendMessage).not.toHaveBeenCalled();
	});

	it("does nothing without a search query", async () => {
		const context = createReplaceAll({ search: "", replace: "bar" });
		await vm.runInContext("replaceAll()", context);

		expect(context.sendMessage).not.toHaveBeenCalled();
		expect(context.sendNativeSearch).not.toHaveBeenCalled();
		expect(context.replacing).toBe(false);
	});
});

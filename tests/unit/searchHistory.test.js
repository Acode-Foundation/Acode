import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

const source = readFileSync(
	`${process.cwd()}/src/lib/searchHistory.js`,
	"utf8",
);

function createHistory() {
	const localStorage = {
		getItem: vi.fn(() => null),
		setItem: vi.fn(),
	};
	const context = vm.createContext({ console, localStorage });
	vm.runInContext(source.slice(0, source.indexOf("export default")), context);
	return {
		context,
		localStorage,
		history: vm.runInContext("new SearchHistory()", context),
	};
}

describe("search history", () => {
	it("preserves exact patterns when requested", () => {
		const { history, localStorage } = createHistory();

		history.addToHistory("  foo\nbar  ", { preserveWhitespace: true });

		expect(history.getHistory()).toEqual(["  foo\nbar  "]);
		expect(localStorage.setItem).toHaveBeenCalledWith(
			"acode.searchreplace.history",
			JSON.stringify(["  foo\nbar  "]),
		);
	});

	it("retains trimmed history as the default behavior", () => {
		const { history } = createHistory();

		history.addToHistory("  foo  ");

		expect(history.getHistory()).toEqual(["foo"]);
	});
});

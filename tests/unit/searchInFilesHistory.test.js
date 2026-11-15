import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

const source = readFileSync(
	`${process.cwd()}/src/sidebarApps/searchInFiles/index.js`,
	"utf8",
);

function createContext({ history = ["second", "first"] } = {}) {
	const searchElement = {
		value: "draft",
		dispatchEvent: vi.fn(),
		focus: vi.fn(),
	};
	const replaceElement = {
		value: "replacement",
		dispatchEvent: vi.fn(),
		focus: vi.fn(),
	};
	const searchHistory = {
		addToHistory: vi.fn(),
		getHistory: vi.fn(() => history),
		navigateSearchUp: vi.fn(() => "first"),
		navigateSearchDown: vi.fn(() => "draft"),
		navigateReplaceUp: vi.fn(() => "old replacement"),
		navigateReplaceDown: vi.fn(() => "replacement"),
		resetSearchNavigation: vi.fn(),
		resetReplaceNavigation: vi.fn(),
	};
	const context = vm.createContext({
		$search: {
			el: searchElement,
			get value() {
				return searchElement.value;
			},
		},
		$replace: {
			el: replaceElement,
			get value() {
				return replaceElement.value;
			},
		},
		searchHistory,
		select: vi.fn(async () => history[0]),
		Event: class Event {
			constructor(type, options) {
				this.type = type;
				this.bubbles = options?.bubbles;
			}
		},
	});
	vm.runInContext(
		source.slice(
			source.indexOf("function rememberSearchPattern()"),
			source.indexOf("/**\n * Worker message handler"),
		),
		context,
	);
	return { context, searchElement, replaceElement, searchHistory };
}

describe("Search in Files pattern history", () => {
	it("recalls search history with the up arrow and refreshes the search", () => {
		const { context, searchElement, searchHistory } = createContext();
		const event = { key: "ArrowUp", preventDefault: vi.fn() };
		context.event = event;

		vm.runInContext("onSearchHistoryKeydown(event)", context);

		expect(event.preventDefault).toHaveBeenCalled();
		expect(searchHistory.navigateSearchUp).toHaveBeenCalledWith("draft");
		expect(searchElement.value).toBe("first");
		expect(searchElement.dispatchEvent).toHaveBeenCalled();
		expect(searchElement.focus).toHaveBeenCalled();
	});

	it("opens the persisted history and applies the selected pattern", async () => {
		const { context, searchElement } = createContext();

		await vm.runInContext('openPatternHistory($search, "Search")', context);

		expect(searchElement.value).toBe("second");
		expect(searchElement.dispatchEvent).toHaveBeenCalled();
	});

	it("stores search and replace values when their fields are committed", () => {
		const { context, searchHistory } = createContext();

		vm.runInContext(
			"rememberSearchPattern(); rememberReplacePattern();",
			context,
		);

		expect(searchHistory.addToHistory).toHaveBeenNthCalledWith(1, "draft");
		expect(searchHistory.addToHistory).toHaveBeenNthCalledWith(
			2,
			"replacement",
		);
	});
});

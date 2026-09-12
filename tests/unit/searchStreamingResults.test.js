// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { expect, it, vi } from "vitest";
import { createSearchResultView } from "sidebarApps/searchInFiles/cmResultView";
vi.mock("lib/settings", () => ({ default: { value: {} } }));
vi.mock("utils/helpers", () => ({
	default: { getIconForFile: (name) => `icon-${name}` },
}));

it("appends interleaved batches without losing matches or counting files twice", () => {
	const source = readFileSync(
		`${process.cwd()}/src/sidebarApps/searchInFiles/index.js`,
		"utf8",
	);
	let text = "";
	const context = vm.createContext({
		filesSearched: [],
		fileNames: [],
		words: [],
		results: [],
		Tree: { fromJSON: (file) => file },
		resultOverview: { filesCount: 0, matchesCount: 0 },
		$resultOverview: {},
		searchResultText: () => "",
		MAX_HL_WORDS: 0,
		searchResult: {
			setValue(value) {
				text = value;
			},
		},
		appendSearchResultText(value) {
			text += value;
		},
	});
	vm.runInContext(
		source.slice(
			source.indexOf("function appendSearchResult(data)"),
			source.indexOf("function enqueueNativeSearchResults"),
		) +
			source.slice(
				source.indexOf("function groupMatchesForDisplay"),
				source.indexOf("async function finishSearchTask"),
			),
		context,
	);
	const add = (url, row, limited = false) => {
		context.batch = {
			file: { name: url, url },
			matches: [{ line: "match", position: { start: { row, column: 0 } } }],
			limited,
		};
		vm.runInContext("appendSearchResult(batch)", context);
	};
	add("a", 0);
	add("a", 1);
	add("b", 0);
	add("a", 2, true);
	expect(context.resultOverview).toEqual({ filesCount: 2, matchesCount: 4 });
	expect(context.fileNames.map((file) => file.count)).toEqual([3, 1]);
	expect(text).toBe(
		"a\n\t1: match\n\t2: match\nb\n\t1: match\na\n\t3: match\n\t... result limit reached for this file",
	);
	expect(context.results.filter((r) => r.position).map((r) => r.file)).toEqual([
		0, 0, 1, 0,
	]);
	const container = document.createElement("div");
	document.body.append(container);
	const resultView = createSearchResultView(container, {
		getFileInfo: (line) => context.fileNames[context.results[line]?.file],
		getWords: () => [],
	});
	try {
		resultView.setValue(text);
		expect(
			[...container.querySelectorAll(".cm-fileCount")].map(
				(el) => el.textContent,
			),
		).toEqual(["3", "1", "3"]);
		expect(container.querySelectorAll(".icon-a")).toHaveLength(2);
		expect(container.querySelectorAll(".icon-b")).toHaveLength(1);
	} finally {
		resultView.view.destroy();
		container.remove();
	}
});

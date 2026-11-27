// @vitest-environment happy-dom
import { createRequire } from "node:module";
import tag from "html-tag-js";
import Ref from "html-tag-js/ref";
import { afterEach, expect, it, vi } from "vitest";
import strings from "../../src/lang/en-us.json";
import { loadSourceModule } from "../helpers/loadSourceModule";

createRequire(import.meta.url)("html-tag-js/polyfill");

afterEach(() => {
	document.body.replaceChildren();
	vi.restoreAllMocks();
	vi.useRealTimers();
});

it("completes search cleanup once even when the caller's close callback throws", async () => {
	vi.useFakeTimers();
	const error = new Error("Caller cleanup failed");
	const onhide = vi.fn(() => {
		throw error;
	});
	const log = vi.spyOn(console, "error").mockImplementation(() => {});
	const { hide, list, children, search, remove } = setup(onhide);
	const input = document.querySelector("#search-bar input");
	input.value = "first";
	input.dispatchEvent(new Event("input"));
	await vi.advanceTimersByTimeAsync(500);
	expect(list.children).toHaveLength(1);
	input.value = "pending";
	input.dispatchEvent(new Event("input"));

	expect(hide).not.toThrow();
	expect([...list.children]).toEqual(children);
	expect(log).toHaveBeenCalledWith("Search close callback failed:", error);
	hide();
	await vi.advanceTimersByTimeAsync(1000);
	expect(onhide).toHaveBeenCalledTimes(1);
	expect(remove).toHaveBeenCalledExactlyOnceWith("searchbar");
	expect(search).toHaveBeenCalledTimes(1);
	expect(document.querySelector("#search-bar")).toBeNull();
});

function setup(onhide) {
	const list = document.createElement("div");
	const children = [
		document.createElement("div"),
		document.createElement("div"),
	];
	list.append(...children);
	document.body.append(list);
	const remove = vi.fn();
	const search = vi.fn(() => [children[0]]);
	const { default: searchBar } = loadSourceModule(
		"src/components/searchbar/index.js",
		{
			"./style.scss": {},
			"components/checkbox": { updateSwitchHandle: vi.fn() },
			"html-tag-js/ref": Ref,
			"lib/actionStack": { push: vi.fn(), remove },
		},
		{ tag, strings, app: document.body, setTimeout, clearTimeout },
	);
	let hide;
	searchBar(
		list,
		(callback) => {
			hide = callback;
		},
		onhide,
		search,
		false,
	);
	return { hide, list, children, search, remove };
}

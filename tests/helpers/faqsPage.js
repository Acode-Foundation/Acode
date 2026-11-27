import { createRequire } from "node:module";
import DOMPurify from "dompurify";
import tag from "html-tag-js";
import Ref from "html-tag-js/ref";
import markdownIt from "markdown-it";
import { vi } from "vitest";
import strings from "../../src/lang/en-us.json";
import { loadSourceModule } from "./loadSourceModule";

createRequire(import.meta.url)("html-tag-js/polyfill");

export default function setup(fetch, localeStrings = strings, isIOS = false) {
	const page = document.createElement("section");
	const header = document.createElement("header");
	Object.defineProperty(page, "body", {
		get: () => page.querySelector("main"),
		set: (body) => page.replaceChildren(header, body),
	});
	page.hide = () => {
		page.onhide();
		page.remove();
	};
	const remove = vi.fn();
	const stack = { push: vi.fn(), remove };
	const globals = {
		tag,
		strings: localeStrings,
		app: document.body,
		fetch,
		localStorage,
		AbortController,
		URL,
		setTimeout,
		clearTimeout,
	};
	const { default: searchBar } = loadSourceModule(
		"src/components/searchbar/index.js",
		{
			"./style.scss": {},
			"components/checkbox": { updateSwitchHandle: vi.fn() },
			"html-tag-js/ref": Ref,
			"lib/actionStack": stack,
		},
		globals,
	);
	const { default: FAQs } = loadSourceModule(
		"src/pages/faqs/faqs.js",
		{
			"./faqs.scss": {},
			dompurify: DOMPurify,
			"markdown-it": markdownIt,
			"lang/en-us.json": strings,
			"components/page": (title, options) => {
				header.append(options.tail);
				return page;
			},
			"components/searchbar": searchBar,
			"lib/actionStack": stack,
			"lib/platform": { isIOS },
			"lib/config": {
				BASE_URL: "https://acode.app",
				API_BASE: "https://acode.app/api",
			},
		},
		globals,
	);
	FAQs();
	return { page, remove };
}

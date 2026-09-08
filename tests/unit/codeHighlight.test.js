// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";

const themeListeners = [];

vi.mock("lib/settings", () => ({
	default: {
		value: { editorTheme: "one_dark" },
		on(event, callback) {
			if (event === "update:editorTheme:after") {
				themeListeners.push(callback);
			}
		},
	},
}));

import "cm/supportedModes";
import settings from "lib/settings";
import {
	HIGHLIGHT_CLASS,
	applyHighlightStyles,
	clearHighlightCache,
	getHighlightStyleSheet,
	getHighlightStyles,
	highlightCodeBlock,
	highlightLine,
	initHighlighting,
} from "utils/codeHighlight";

function adoptCount(root, sheet) {
	return Array.from(root.adoptedStyleSheets || []).filter(
		(entry) => entry === sheet,
	).length;
}

describe("codeHighlight", () => {
	beforeEach(() => {
		settings.value.editorTheme = "one_dark";
		clearHighlightCache();
		document
			.querySelectorAll("#cm-static-highlight-styles")
			.forEach((node) => node.remove());
	});

	it("emits token CSS for the current editor theme", () => {
		const css = getHighlightStyles();
		expect(css).toContain(`.${HIGHLIGHT_CLASS}`);
		expect(css).toContain(".tok-keyword");
		expect(css).toContain(".tok-string");
		expect(css).toContain("#c678dd");
	});

	it("highlights a JavaScript code block with token spans", async () => {
		const html = await highlightCodeBlock(
			'const answer = "forty-two";',
			"javascript",
		);
		expect(html).toContain("tok-");
		expect(html).toContain("answer");
		expect(html).toContain("forty-two");
		expect(html).not.toContain("<script");
	});

	it("escapes HTML when highlighting fails or language is unknown", async () => {
		const html = await highlightCodeBlock(
			'<img src=x onerror="alert(1)">',
			"not-a-real-language",
		);
		expect(html).toContain("&lt;img");
		expect(html).not.toContain("<img");
	});

	it("highlights a single line from a file URI", async () => {
		const html = await highlightLine(
			"export function greet() {}",
			"file:///tmp/hello.js",
			"greet",
		);
		expect(html).toContain("greet");
		expect(html).toContain("symbol-match");
	});

	it("returns empty string for blank input", async () => {
		expect(await highlightCodeBlock("")).toBe("");
		expect(await highlightLine("   ", "file.js")).toBe("");
	});

	it("adopts the highlight stylesheet into a shadow root", () => {
		initHighlighting();
		const host = document.createElement("div");
		const shadow = host.attachShadow({ mode: "open" });

		const applied = applyHighlightStyles(shadow);
		const sheet = getHighlightStyleSheet();

		expect(sheet).toBeTruthy();
		expect(applied).toBe(sheet);
		expect(adoptCount(shadow, sheet)).toBe(1);
	});

	it("does not duplicate the adopted sheet on repeated apply", () => {
		const host = document.createElement("div");
		const shadow = host.attachShadow({ mode: "open" });
		applyHighlightStyles(shadow);
		applyHighlightStyles(shadow);
		applyHighlightStyles(host);

		const sheet = getHighlightStyleSheet();
		expect(adoptCount(shadow, sheet)).toBe(1);
	});

	it("resolves a host element to its shadow root", () => {
		const host = document.createElement("div");
		const shadow = host.attachShadow({ mode: "open" });
		applyHighlightStyles(host);

		const sheet = getHighlightStyleSheet();
		expect(adoptCount(shadow, sheet)).toBe(1);
	});

	it("keeps highlight colors after the host replaces adoptedStyleSheets", () => {
		const host = document.createElement("div");
		const shadow = host.attachShadow({ mode: "open" });
		const other = new CSSStyleSheet();
		other.replaceSync(":host { display: block; }");
		shadow.adoptedStyleSheets = [other];

		applyHighlightStyles(shadow);

		const sheet = getHighlightStyleSheet();
		expect(shadow.adoptedStyleSheets).toContain(other);
		expect(shadow.adoptedStyleSheets).toContain(sheet);
	});

	it("updates fallback styles while the shadow host is still detached", () => {
		initHighlighting();
		const host = document.createElement("div");
		const shadow = host.attachShadow({ mode: "open" });
		Object.defineProperty(shadow, "adoptedStyleSheets", {
			configurable: true,
			get() {
				throw new Error("adoptedStyleSheets unavailable");
			},
			set() {
				throw new Error("adoptedStyleSheets unavailable");
			},
		});

		applyHighlightStyles(shadow);
		const style = shadow.querySelector("#cm-static-highlight-styles");
		expect(style).toBeTruthy();
		expect(style.isConnected).toBe(false);
		expect(style.textContent).toContain("#c678dd");

		settings.value.editorTheme = "githubLight";
		for (const listener of themeListeners) listener();

		expect(style.parentNode).toBe(shadow);
		expect(style.textContent).toContain("#cf222e");
	});

	it("updates adopted shadow styles when the editor theme changes", () => {
		initHighlighting();
		const host = document.createElement("div");
		const shadow = host.attachShadow({ mode: "open" });
		applyHighlightStyles(shadow);

		const sheet = getHighlightStyleSheet();
		const before = getHighlightStyles();
		expect(before).toContain("#c678dd");

		settings.value.editorTheme = "githubLight";
		for (const listener of themeListeners) listener();

		const after = getHighlightStyles();
		expect(after).toContain("#cf222e");
		expect(after).not.toBe(before);
		expect(shadow.adoptedStyleSheets).toContain(sheet);
	});
});

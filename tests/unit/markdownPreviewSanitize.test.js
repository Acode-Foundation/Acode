// @vitest-environment happy-dom
import sanitizeMarkdownHtml from "pages/markdownPreview/sanitize";
import { describe, expect, it } from "vitest";

describe("markdown preview sanitizer", () => {
	it("keeps generated KaTeX styles and strips lookalike raw HTML", () => {
		const marker = "katex-test";
		const html = sanitizeMarkdownHtml(
			`<span data-acode-katex="${marker}"><span class="katex" style="height:1em">math</span></span><div class="katex" style="position:fixed;color:red">fake</div>`,
			marker,
		);

		expect(html).toContain("height:1em");
		expect(html).not.toContain("position:fixed");
	});

	it("strips styles when raw HTML claims to be KaTeX", () => {
		const html = sanitizeMarkdownHtml(
			'<div class="katex" style="position:fixed;color:red">fake controls</div>',
			"only-this-render",
		);

		expect(html).not.toContain("position:fixed");
	});

	it("removes style elements", () => {
		const html = sanitizeMarkdownHtml(
			"<style>body{display:none}</style><p>ok</p>",
		);

		expect(html).not.toContain("display:none");
		expect(html).toContain("<p>ok</p>");
	});
});

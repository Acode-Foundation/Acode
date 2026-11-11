// @vitest-environment happy-dom
import sanitizeMarkdownHtml from "pages/markdownPreview/sanitize";
import { describe, expect, it } from "vitest";

describe("markdown preview sanitizer", () => {
	it("removes raw inline styles but keeps KaTeX layout styles", () => {
		const html = sanitizeMarkdownHtml(
			'<div style="position:fixed;color:red">text</div><span class="katex" style="height:1em">math</span>',
		);

		expect(html).not.toContain("position:fixed");
		expect(html).toContain('class="katex"');
		expect(html).toContain("height:1em");
	});

	it("removes style elements", () => {
		const html = sanitizeMarkdownHtml(
			"<style>body{display:none}</style><p>ok</p>",
		);

		expect(html).not.toContain("display:none");
		expect(html).toContain("<p>ok</p>");
	});
});

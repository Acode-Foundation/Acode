import DOMPurify from "dompurify";

export default function sanitizeMarkdownHtml(html) {
	const limitStyleAttributes = (node, data) => {
		// KaTeX needs inline styles for layout; block styles from raw markdown.
		if (data.attrName === "style" && !node.closest?.(".katex")) {
			data.keepAttr = false;
		}
	};

	DOMPurify.addHook("uponSanitizeAttribute", limitStyleAttributes);
	try {
		return DOMPurify.sanitize(html, {
			FORBID_TAGS: ["style"],
			ADD_TAGS: ["eq", "eqn"],
		});
	} finally {
		DOMPurify.removeHook("uponSanitizeAttribute", limitStyleAttributes);
	}
}

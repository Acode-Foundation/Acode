import DOMPurify from "dompurify";

export default function sanitizeMarkdownHtml(html, katexMarker = "") {
	const katexSelector = katexMarker
		? `[data-acode-katex="${katexMarker}"]`
		: null;
	const limitStyleAttributes = (node, data) => {
		// Only generated KaTeX output carries the per-render marker.
		if (
			data.attrName === "style" &&
			(!katexSelector || !node.closest?.(katexSelector))
		) {
			data.keepAttr = false;
		}
	};

	DOMPurify.addHook("uponSanitizeAttribute", limitStyleAttributes);
	try {
		return DOMPurify.sanitize(html, {
			FORBID_TAGS: ["style"],
			ADD_TAGS: ["eq", "eqn"],
			ADD_ATTR: ["data-acode-katex"],
		});
	} finally {
		DOMPurify.removeHook("uponSanitizeAttribute", limitStyleAttributes);
	}
}

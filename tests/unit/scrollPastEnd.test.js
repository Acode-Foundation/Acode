import { describe, expect, it } from "vitest";
import { horizontalScrollPastEnd } from "cm/scrollPastEnd";

function themeRules(extension) {
	return extension
		.flatMap((part) => part?.value?.rules ?? [])
		.join("\n");
}

describe("horizontal scroll past end", () => {
	it("adds right-side space only to unwrapped editor content", () => {
		const rules = themeRules(horizontalScrollPastEnd(50));

		expect(rules).toContain(".cm-content:not(.cm-lineWrapping)");
		expect(rules).toContain("padding-right: 50px");
	});

	it("normalizes invalid distances without adding a theme", () => {
		expect(horizontalScrollPastEnd(0)).toEqual([]);
		expect(horizontalScrollPastEnd(Number.NaN)).toEqual([]);
		expect(themeRules(horizontalScrollPastEnd(12.6))).toContain(
			"padding-right: 13px",
		);
	});
});

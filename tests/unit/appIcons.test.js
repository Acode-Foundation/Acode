import { describe, expect, it } from "vitest";
import { APP_ICONS } from "lib/appIcons";

describe("appIcons", () => {
	it("exposes the default icon first", () => {
		expect(APP_ICONS[0].id).toBe("default");
	});

	it("references an svg preview for each icon", () => {
		for (const icon of APP_ICONS) {
			expect(icon.image).toMatch(/\.svg$/);
		}
	});
});

import { describe, expect, it } from "vitest";
import { APP_ICONS, getAppIconLabel } from "lib/appIcons";

describe("appIcons", () => {
	it("exposes the default icon first", () => {
		expect(APP_ICONS[0].id).toBe("default");
	});

	it("references an svg preview for each icon", () => {
		for (const icon of APP_ICONS) {
			expect(icon.image).toMatch(/\.svg$/);
		}
	});

	describe("getAppIconLabel", () => {
		it("returns the label for a known icon", () => {
			expect(getAppIconLabel("midnight_circuit")).toBe("Midnight Circuit");
		});

		it("falls back to the default label for unknown icons", () => {
			expect(getAppIconLabel("unknown_icon")).toBe("Default");
		});
	});
});

import fs from "node:fs";
import { parse } from "elementtree";
import { APP_ICONS } from "lib/appIcons";
import { describe, expect, it } from "vitest";

describe("appIcons", () => {
	it("exposes the default icon first", () => {
		expect(APP_ICONS[0].id).toBe("default");
	});

	it("references an svg preview for each icon", () => {
		for (const icon of APP_ICONS) {
			expect(icon.image).toMatch(/\.svg$/);
		}
	});

	it("keeps picker IDs, native mappings, and launcher aliases in sync", () => {
		const native = fs.readFileSync(
			new URL(
				"../../src/plugins/system/android/com/foxdebug/system/System.java",
				import.meta.url,
			),
			"utf8",
		);
		const mappings = [
			...native.matchAll(/aliases\.put\("([^"]+)", "([^"]+)"\);/g),
		].map(([, id, name]) => [id, name]);
		expect(mappings.map(([id]) => id)).toEqual(APP_ICONS.map(({ id }) => id));
		expect(new Set(mappings.map(([, name]) => name)).size).toBe(
			APP_ICONS.length,
		);
		const config = parse(
			fs.readFileSync(new URL("../../config.xml", import.meta.url), "utf8"),
		);
		expect(
			config
				.findall(".//activity-alias")
				.map((alias) => alias.get("android:name")),
		).toEqual(mappings.map(([, name]) => `.${name}`));
	});
});

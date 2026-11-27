import fs from "node:fs";
import { Window } from "happy-dom";
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
				"../../platforms/android/app/src/main/java/com/foxdebug/acode/system/System.java",
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
		const window = new Window();
		const config = new window.DOMParser().parseFromString(
			fs.readFileSync(
				new URL(
					"../../platforms/android/app/src/main/AndroidManifest.xml",
					import.meta.url,
				),
				"utf8",
			),
			"application/xml",
		);
		expect(
			[...config.querySelectorAll("activity-alias")].map((alias) =>
				resolveAlias(alias.getAttribute("android:name")),
			),
		).toEqual(mappings.map(([, name]) => `\${applicationId}.${name}`));
		window.happyDOM.abort();
	});
});

function resolveAlias(name) {
	return name.startsWith(".") ? `\${applicationId}${name}` : name;
}

import { readFileSync } from "node:fs";
import mustache from "mustache";
import { expect, it } from "vitest";

const template = readFileSync(
	new URL("../../src/views/file-menu.hbs", import.meta.url),
	"utf8",
);

it.each([
	false,
	true,
])("shows Android-only file actions when supported: %s", (androidIntents) => {
	const menu = mustache.render(template, {
		file_on_disk: true,
		android_intents: androidIntents,
	});
	for (const action of ["edit-with", "pin-file-shortcut"]) {
		expect(menu.includes(`action="${action}"`)).toBe(androidIntents);
	}
	for (const action of ["share", "open-with", "toggle-pin-tab"]) {
		expect(menu).toContain(`action="${action}"`);
	}
});

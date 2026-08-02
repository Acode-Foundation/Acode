import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
	getThemeConfig,
	getThemeExtensions,
	getThemes,
} from "cm/themes";

describe("built-in editor themes", () => {
	it("uses the base editor foreground for plain VS Code text", () => {
		expect(getThemeConfig("vscodeDark")).toMatchObject({
			background: "#1f1f1f",
			foreground: "#cccccc",
			variable: "#9cdcfe",
		});
	});

	it("uses the current GitHub Dark palette", () => {
		expect(getThemeConfig("githubDark")).toMatchObject({
			background: "#0d1117",
			foreground: "#e6edf3",
			variable: "#e6edf3",
		});
	});

	it("uses current canonical foregrounds for the audited themes", () => {
		expect(getThemeConfig("githubLight")).toMatchObject({
			background: "#ffffff",
			foreground: "#1f2328",
		});
		expect(getThemeConfig("solarizedDark")).toMatchObject({
			background: "#002B36",
			foreground: "#839496",
		});
		expect(getThemeConfig("solarizedLight")).toMatchObject({
			background: "#FDF6E3",
			foreground: "#657B83",
		});
		expect(getThemeConfig("tokyoNight")).toMatchObject({
			background: "#1a1b26",
			foreground: "#a9b1d6",
		});
	});

	it("registers every official Catppuccin CodeMirror flavor", () => {
		const ids = getThemes().map((theme) => theme.id);
		for (const id of [
			"catppuccinlatte",
			"catppuccinfrappe",
			"catppuccinmacchiato",
			"catppuccinmocha",
		]) {
			expect(ids).toContain(id);
		}
	});

	it("constructs every registered editor theme", () => {
		for (const { id } of getThemes()) {
			expect(() =>
				EditorState.create({ extensions: getThemeExtensions(id) }),
			).not.toThrow();
		}
	});
});

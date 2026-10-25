import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { Compartment, Prec } from "@codemirror/state";
import { tags as t } from "@lezer/highlight";
import {
	findHighlightStyle,
	fontSizeToPx,
	getCanvasDisplayOptions,
	getCanvasFont,
	getCanvasTheme,
} from "cm/canvasOptions";
import { getThemeConfig, getThemes } from "cm/themes";
import { describe, expect, it } from "vitest";

describe("canvas renderer theme bridge", () => {
	it("finds the HighlightStyle inside wrapped theme extensions", () => {
		const style = HighlightStyle.define([{ tag: t.keyword, color: "#f00" }]);
		const compartment = new Compartment();
		const extension = [
			[],
			compartment.of(Prec.high([syntaxHighlighting(style)])),
		];
		expect(findHighlightStyle(extension)).toBe(style);
		expect(findHighlightStyle([])).toBeNull();
	});

	it("gives every built-in theme syntax colors and its config colors", () => {
		for (const theme of getThemes()) {
			const spec = getCanvasTheme(theme.id);
			const config = getThemeConfig(theme.id);
			expect(spec.background, theme.id).toBe(config.background);
			expect(spec.foreground, theme.id).toBe(config.foreground);
			expect(spec.dark, theme.id).toBe(config.dark !== false);
			expect(spec.highlight, theme.id).toBeInstanceOf(HighlightStyle);
			// Acode's own scrollbars are used instead of the canvas thumbs.
			expect(spec.scrollbar).toBe("transparent");
		}
	});

	it("maps the theme's line number and bracket colors", () => {
		const config = getThemeConfig("dracula");
		expect(getCanvasTheme("dracula")).toMatchObject({
			selection: config.selection,
			cursor: config.cursor,
			gutterForeground: config.lineNumber,
			gutterActiveForeground: config.lineNumberActive,
			classes: {
				"cm-matchingBracket": { background: config.matchingBracket },
				"cm-selectionMatch": { background: config.selection },
			},
		});
	});
});

describe("canvas renderer settings", () => {
	const defaults = {
		linenumbers: true,
		relativeLineNumbers: false,
		fadeFoldWidgets: false,
		textWrap: false,
		wrappingIndent: "same",
		leftMargin: 50,
		scrollPastEnd: "medium",
		scrollSpeed: "NORMAL",
		indentGuides: false,
		rainbowBrackets: true,
		showSpaces: false,
		highlightActiveLine: true,
		cursorWidth: 2,
		rtlText: false,
	};

	it("maps Acode's editor settings to canvas options", () => {
		const options = getCanvasDisplayOptions(defaults, { themeId: "one_dark" });
		expect(options).toMatchObject({
			lineNumbers: true,
			foldMarkers: "always",
			lineWrapping: false,
			wrapIndent: "same",
			horizontalScrollPastEnd: 50,
			scrollPastEnd: 0.5,
			scrollSpeed: "normal",
			indentGuides: false,
			showWhitespace: false,
			highlightActiveLine: true,
			cursorWidth: 2,
			cursorBlinkRate: 1200,
			gutterMarkers: "shared",
			stickyScroll: false,
			textDirection: "ltr",
		});
		expect(options.rainbowBrackets).toMatchObject({
			colors: expect.any(Array),
		});
	});

	it("follows changed settings", () => {
		const options = getCanvasDisplayOptions(
			{
				...defaults,
				relativeLineNumbers: true,
				fadeFoldWidgets: true,
				textWrap: true,
				wrappingIndent: "deepIndent",
				scrollPastEnd: "none",
				scrollSpeed: "FAST_X2",
				indentGuides: true,
				rainbowBrackets: false,
				showSpaces: true,
				cursorWidth: 40,
				cursorBlinkRate: "0",
				canvasGutterMarkers: "overlay",
				stickyScroll: true,
				stickyScrollMaxLines: 30,
				rtlText: true,
			},
			{ themeId: "one_dark" },
		);
		expect(options).toMatchObject({
			lineNumbers: "relative",
			foldMarkers: "fade",
			lineWrapping: true,
			wrapIndent: "deepIndent",
			scrollPastEnd: 0,
			scrollSpeed: "fastX2",
			indentGuides: { active: true },
			rainbowBrackets: false,
			showWhitespace: { spaces: true, trailing: true, lineBreaks: true },
			cursorWidth: 10,
			cursorBlinkRate: 0,
			gutterMarkers: "overlay",
			stickyScroll: { maxLines: 10 },
			textDirection: "auto",
		});
		expect(
			getCanvasDisplayOptions(
				{ ...defaults, linenumbers: false },
				{ themeId: "one_dark" },
			).lineNumbers,
		).toBe(false);
		expect(
			getCanvasDisplayOptions(
				{
					...defaults,
					stickyScroll: true,
					canvasGutterMarkers: "bad",
					cursorBlinkRate: "bad",
				},
				{ themeId: "one_dark" },
			),
		).toMatchObject({
			stickyScroll: { maxLines: 5 },
			gutterMarkers: "shared",
			cursorBlinkRate: 1200,
		});
	});

	it("converts the editor font settings", () => {
		expect(fontSizeToPx("14px")).toBe(14);
		expect(fontSizeToPx("12pt")).toBe(16);
		expect(fontSizeToPx("bad")).toBe(12);
		expect(
			getCanvasFont({ fontSize: "13px", lineHeight: 2 }, "Roboto Mono"),
		).toEqual({ family: "Roboto Mono", size: 13, lineHeight: 2 });
	});
});

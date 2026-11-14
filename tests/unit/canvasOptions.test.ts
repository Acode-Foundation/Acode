import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { Compartment, Prec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import {
	findHighlightStyle,
	fontSizeToPx,
	getCanvasDisplayOptions,
	getCanvasFont,
	getCanvasTheme,
	themeRuleColors,
} from "cm/canvasOptions";
import { addTheme, getThemeConfig, getThemes, removeTheme } from "cm/themes";
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

	// A plugin theme with only text colors in its config, and the rest in
	// its EditorView.theme.
	const cssOnlyTheme = () =>
		EditorView.theme(
			{
				"&": { color: "#bbbbbb", backgroundColor: "#111113" },
				".cm-cursor, .cm-dropCursor": { borderLeftColor: "#aeafad" },
				".cm-selectionBackground": { backgroundColor: "rgba(46, 49, 53, 0.5)" },
				"&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground":
					{ backgroundColor: "#2e3135" },
				".cm-activeLine": {
					backgroundColor: "transparent",
					boxShadow: "0 0 0 2px #282828 inset",
				},
				".cm-gutters": {
					backgroundColor: "#111113",
					color: "#696e77",
					border: "none",
				},
				".cm-activeLineGutter": {
					backgroundColor: "transparent",
					color: "#c6c6c6",
				},
			},
			{ dark: true },
		);

	it("reads surface colors from a theme's own rules", () => {
		expect(themeRuleColors([cssOnlyTheme()])).toEqual({
			cursor: "#aeafad",
			selection: "#2e3135",
			activeLine: "transparent",
			activeLineBorder: "#282828",
			activeLineBorderWidth: 2,
			gutterBackground: "#111113",
			gutterForeground: "#696e77",
			activeLineGutter: "transparent",
			gutterActiveForeground: "#c6c6c6",
		});
		// Shadows that aren't a plain frame, and var() colors, are left alone.
		const other = EditorView.theme({
			".cm-activeLine": { boxShadow: "0 2px 4px #000 inset" },
			".cm-cursor": { borderLeftColor: "var(--cursor)" },
		});
		expect(themeRuleColors([other])).toEqual({});
	});

	it("draws a plugin theme's CSS-only surfaces on the canvas", () => {
		addTheme(
			"canvas-test-css-theme",
			"CSS theme test",
			true,
			() => [cssOnlyTheme()],
			{
				name: "canvas-test-css-theme",
				dark: true,
				background: "#111113",
				foreground: "#BBBBBB",
			},
		);
		try {
			expect(getCanvasTheme("canvas-test-css-theme")).toMatchObject({
				background: "#111113",
				cursor: "#aeafad",
				selection: "#2e3135",
				activeLine: "transparent",
				activeLineBorder: "#282828",
				activeLineBorderWidth: 2,
				gutterBackground: "#111113",
				gutterForeground: "#696e77",
				gutterActiveForeground: "#c6c6c6",
			});
			// The config's own colors win over the rules.
			removeTheme("canvas-test-css-theme");
			addTheme(
				"canvas-test-css-theme",
				"CSS theme test",
				true,
				() => [cssOnlyTheme()],
				{
					name: "canvas-test-css-theme",
					dark: true,
					background: "#111113",
					foreground: "#BBBBBB",
					activeLine: "#202020",
					cursor: "#ff0000",
				},
			);
			const spec = getCanvasTheme("canvas-test-css-theme");
			expect(spec).toMatchObject({ activeLine: "#202020", cursor: "#ff0000" });
			expect(spec.activeLineBorder).toBeUndefined();
		} finally {
			removeTheme("canvas-test-css-theme");
		}
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

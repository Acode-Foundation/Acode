// @vitest-environment happy-dom

import { cssThemeSpec, parseColor, themeCSSOf } from "@acode.app/canvas-view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import {
	fontSizeToPx,
	getCanvasDisplayOptions,
	getCanvasFont,
	getCanvasTheme,
} from "cm/canvasOptions";
import {
	addTheme,
	getThemeConfig,
	getThemeExtensions,
	getThemes,
	removeTheme,
} from "cm/themes";
import { describe, expect, it } from "vitest";

/** Whether an extension tree holds a HighlightStyle. */
function findHighlighters(
	extension: unknown,
	seen = new Set<unknown>(),
): boolean {
	if (!extension || typeof extension !== "object" || seen.has(extension)) {
		return false;
	}
	seen.add(extension);
	if (extension instanceof HighlightStyle) return true;
	if (Array.isArray(extension)) {
		return extension.some((item) => findHighlighters(item, seen));
	}
	const node = extension as Record<string, unknown>;
	return (
		findHighlighters(node.value, seen) ||
		findHighlighters(node.inner, seen) ||
		findHighlighters(node.extension, seen)
	);
}

describe("canvas renderer theme bridge", () => {
	// What a canvas view draws a theme with: canvas-view resolves the
	// theme's CSS from the state, and Acode's theme function adjusts it.
	const specFor = (id: string, seeThrough = false) => {
		const state = EditorState.create({
			extensions: getThemeExtensions(id, [oneDark]),
		});
		return {
			spec: getCanvasTheme(id, seeThrough)(cssThemeSpec(state)),
			css: themeCSSOf(state),
		};
	};

	it("gives every built-in theme syntax colors and its config colors", () => {
		for (const theme of getThemes()) {
			const { spec } = specFor(theme.id);
			const config = getThemeConfig(theme.id);
			expect(spec.background, theme.id).toBe(config.background);
			expect(spec.foreground, theme.id).toBe(config.foreground);
			expect(spec.dark, theme.id).toBe(config.dark !== false);
			// Syntax colors come from the highlight style in the state.
			expect(
				findHighlighters(getThemeExtensions(theme.id, [oneDark])),
				theme.id,
			).toBe(true);
			// Acode's own scrollbars are used instead of the canvas thumbs.
			expect(spec.scrollbar).toBe("transparent");
		}
	});

	it("maps the theme's line number and bracket colors", () => {
		const config = getThemeConfig("dracula");
		const { spec, css } = specFor("dracula");
		expect(spec).toMatchObject({
			selection: config.selection,
			cursor: config.cursor,
			gutterForeground: config.lineNumber,
			gutterActiveForeground: config.lineNumberActive,
		});
		// Decoration classes are resolved from the theme's CSS by the view.
		expect(css.mark("cm-matchingBracket")?.background).toBe(
			config.matchingBracket,
		);
		expect(css.mark("cm-selectionMatch")?.background).toBe(config.selection);
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

	it("every built-in theme's CSS agrees with its config", () => {
		const norm = (v: unknown) =>
			typeof v === "string" ? v.toLowerCase().replace(/\s+/g, "") : v;
		for (const theme of getThemes()) {
			const config = getThemeConfig(theme.id);
			const state = EditorState.create({
				extensions: getThemeExtensions(theme.id, [oneDark]),
			});
			const css = cssThemeSpec(state);
			for (const [key, value] of [
				["background", config.background],
				["foreground", config.foreground],
				["selection", config.selection],
				["cursor", config.cursor],
				["activeLine", config.activeLine],
				["gutterForeground", config.lineNumber],
				["gutterActiveForeground", config.lineNumberActive],
			] as const) {
				if (value == null) continue;
				expect(norm(css[key]), `${theme.id} ${key}`).toBe(norm(value));
			}
		}
	});

	it("draws syntax colors from the theme's highlight style over its config", () => {
		const style = HighlightStyle.define([{ tag: t.keyword, color: "#ff0000" }]);
		const config = {
			name: "canvas-test-syntax-theme",
			dark: true,
			background: "#111113",
			foreground: "#bbbbbb",
			keyword: "#00ff00",
		};
		addTheme(
			"canvas-test-syntax-theme",
			"Syntax theme test",
			true,
			() => [
				EditorView.theme(
					{ "&": { backgroundColor: "#111113" } },
					{ dark: true },
				),
				syntaxHighlighting(style),
			],
			config,
		);
		try {
			const state = EditorState.create({
				extensions: getThemeExtensions("canvas-test-syntax-theme", [oneDark]),
			});
			// With a highlight style in the state, the canvas colors tokens from
			// its CSS; the config's colors are only a fallback.
			const keyword = style.style([t.keyword]) as string;
			expect(themeCSSOf(state).token(keyword)?.color).toBe(
				parseColor("#ff0000"),
			);
		} finally {
			removeTheme("canvas-test-syntax-theme");
		}
		// Without one, the canvas theme's own highlight has the config's colors.
		addTheme(
			"canvas-test-syntax-theme",
			"Syntax theme test",
			true,
			() => [
				EditorView.theme(
					{ "&": { backgroundColor: "#111113" } },
					{ dark: true },
				),
			],
			config,
		);
		try {
			const { spec } = specFor("canvas-test-syntax-theme");
			const highlight = spec.highlight as readonly {
				tag: unknown;
				color?: string;
			}[];
			expect(
				highlight.find((s) =>
					([] as unknown[]).concat(s.tag).includes(t.keyword),
				)?.color,
			).toBe("#00ff00");
		} finally {
			removeTheme("canvas-test-syntax-theme");
		}
	});

	it("keeps a see-through canvas over a picture", () => {
		const { spec } = specFor("dracula", true);
		expect(spec.background).toBe("transparent");
		expect(spec.activeLineGutter).toBe("transparent");
		expect(spec.gutterBackground).toBeUndefined();
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
			expect(specFor("canvas-test-css-theme").spec).toMatchObject({
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
			// The CSS is what the DOM editor shows: a config that disagrees
			// with it doesn't change the canvas.
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
			const { spec } = specFor("canvas-test-css-theme");
			expect(spec).toMatchObject({
				activeLine: "transparent",
				activeLineBorder: "#282828",
				cursor: "#aeafad",
			});
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

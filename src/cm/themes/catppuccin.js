import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

const palettes = {
	latte: {
		dark: false,
		rosewater: "#dc8a78",
		pink: "#ea76cb",
		mauve: "#8839ef",
		red: "#d20f39",
		peach: "#fe640b",
		yellow: "#df8e1d",
		green: "#40a02b",
		teal: "#179299",
		sky: "#04a5e5",
		blue: "#1e66f5",
		lavender: "#7287fd",
		text: "#4c4f69",
		subtext0: "#6c6f85",
		overlay2: "#7c7f93",
		overlay1: "#8c8fa1",
		overlay0: "#9ca0b0",
		surface2: "#acb0be",
		surface1: "#bcc0cc",
		surface0: "#ccd0da",
		base: "#eff1f5",
		mantle: "#e6e9ef",
	},
	frappe: {
		dark: true,
		rosewater: "#f2d5cf",
		pink: "#f4b8e4",
		mauve: "#ca9ee6",
		red: "#e78284",
		peach: "#ef9f76",
		yellow: "#e5c890",
		green: "#a6d189",
		teal: "#81c8be",
		sky: "#99d1db",
		blue: "#8caaee",
		lavender: "#babbf1",
		text: "#c6d0f5",
		subtext0: "#a5adce",
		overlay2: "#949cbb",
		overlay1: "#838ba7",
		overlay0: "#737994",
		surface2: "#626880",
		surface1: "#51576d",
		surface0: "#414559",
		base: "#303446",
		mantle: "#292c3c",
	},
	macchiato: {
		dark: true,
		rosewater: "#f4dbd6",
		pink: "#f5bde6",
		mauve: "#c6a0f6",
		red: "#ed8796",
		peach: "#f5a97f",
		yellow: "#eed49f",
		green: "#a6da95",
		teal: "#8bd5ca",
		sky: "#91d7e3",
		blue: "#8aadf4",
		lavender: "#b7bdf8",
		text: "#cad3f5",
		subtext0: "#a5adcb",
		overlay2: "#939ab7",
		overlay1: "#8087a2",
		overlay0: "#6e738d",
		surface2: "#5b6078",
		surface1: "#494d64",
		surface0: "#363a4f",
		base: "#24273a",
		mantle: "#1e2030",
	},
	mocha: {
		dark: true,
		rosewater: "#f5e0dc",
		pink: "#f5c2e7",
		mauve: "#cba6f7",
		red: "#f38ba8",
		peach: "#fab387",
		yellow: "#f9e2af",
		green: "#a6e3a1",
		teal: "#94e2d5",
		sky: "#89dceb",
		blue: "#89b4fa",
		lavender: "#b4befe",
		text: "#cdd6f4",
		subtext0: "#a6adc8",
		overlay2: "#9399b2",
		overlay1: "#7f849c",
		overlay0: "#6c7086",
		surface2: "#585b70",
		surface1: "#45475a",
		surface0: "#313244",
		base: "#1e1e2e",
		mantle: "#181825",
	},
};

function createConfig(name, caption, palette) {
	return {
		name,
		caption,
		dark: palette.dark,
		background: palette.base,
		foreground: palette.text,
		selection: `${palette.overlay2}40`,
		selectionMatch: `${palette.surface2}4d`,
		cursor: palette.rosewater,
		dropdownBackground: palette.mantle,
		dropdownBorder: palette.overlay0,
		activeLine: palette.surface0,
		lineNumber: palette.subtext0,
		lineNumberActive: palette.mauve,
		matchingBracket: `${palette.surface2}47`,
		keyword: palette.mauve,
		variable: palette.text,
		parameter: palette.text,
		function: palette.blue,
		string: palette.green,
		constant: palette.peach,
		type: palette.yellow,
		class: palette.yellow,
		number: palette.peach,
		comment: palette.overlay2,
		heading: palette.blue,
		invalid: palette.red,
		regexp: palette.pink,
		tag: palette.blue,
		operator: palette.sky,
		palette,
	};
}

export const configs = [
	createConfig("catppuccinLatte", "Catppuccin Latte", palettes.latte),
	createConfig("catppuccinFrappe", "Catppuccin Frappé", palettes.frappe),
	createConfig(
		"catppuccinMacchiato",
		"Catppuccin Macchiato",
		palettes.macchiato,
	),
	createConfig("catppuccinMocha", "Catppuccin Mocha", palettes.mocha),
];

function createCatppuccinTheme(config) {
	const colors = config.palette;
	const theme = EditorView.theme(
		{
			"&": {
				color: config.foreground,
				backgroundColor: config.background,
			},
			".cm-content": { caretColor: config.cursor },
			".cm-cursor, .cm-dropCursor": {
				borderLeftColor: config.cursor,
			},
			"&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
				{ backgroundColor: config.selection },
			".cm-panels": {
				backgroundColor: config.dropdownBackground,
				color: config.foreground,
			},
			".cm-panels.cm-panels-top": {
				borderBottom: `1px solid ${config.dropdownBorder}`,
			},
			".cm-panels.cm-panels-bottom": {
				borderTop: `1px solid ${config.dropdownBorder}`,
			},
			".cm-searchMatch": {
				backgroundColor: `${colors.blue}59`,
				outline: `1px solid ${colors.blue}`,
			},
			".cm-searchMatch.cm-searchMatch-selected": {
				backgroundColor: `${colors.blue}2f`,
			},
			".cm-activeLine": { backgroundColor: config.activeLine },
			".cm-selectionMatch": { backgroundColor: config.selectionMatch },
			"&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket": {
				backgroundColor: config.matchingBracket,
				color: config.foreground,
			},
			".cm-gutters": {
				backgroundColor: config.background,
				color: config.lineNumber,
				border: "none",
			},
			".cm-activeLineGutter": { backgroundColor: config.activeLine },
			".cm-lineNumbers .cm-gutterElement": { color: config.lineNumber },
			".cm-lineNumbers .cm-activeLineGutter": {
				color: config.lineNumberActive,
			},
			".cm-foldPlaceholder": {
				backgroundColor: "transparent",
				border: "none",
				color: colors.overlay0,
			},
			".cm-placeholder": { color: colors.overlay1 },
			".cm-tooltip": {
				border: "none",
				backgroundColor: colors.surface0,
				color: config.foreground,
			},
			".cm-tooltip-autocomplete": {
				"& > ul > li[aria-selected]": {
					backgroundColor: colors.surface1,
					color: config.foreground,
				},
			},
		},
		{ dark: config.dark },
	);

	const highlightStyle = HighlightStyle.define([
		{ tag: t.keyword, color: config.keyword },
		{
			tag: [t.name, t.definition(t.name), t.deleted, t.character, t.macroName],
			color: config.variable,
		},
		{
			tag: [
				t.function(t.variableName),
				t.function(t.propertyName),
				t.propertyName,
				t.labelName,
			],
			color: config.function,
		},
		{
			tag: [t.color, t.constant(t.name), t.standard(t.name)],
			color: config.constant,
		},
		{ tag: [t.self, t.atom], color: colors.red },
		{
			tag: [t.typeName, t.className, t.changed, t.annotation, t.namespace],
			color: config.type,
		},
		{ tag: t.operator, color: config.operator },
		{ tag: t.url, color: colors.teal },
		{ tag: [t.escape, t.regexp], color: config.regexp },
		{
			tag: [t.meta, t.punctuation, t.separator, t.comment],
			color: config.comment,
		},
		{ tag: t.strong, fontWeight: "bold" },
		{ tag: t.emphasis, fontStyle: "italic" },
		{ tag: t.strikethrough, textDecoration: "line-through" },
		{ tag: t.link, color: config.function, textDecoration: "underline" },
		{ tag: t.heading, fontWeight: "bold", color: config.heading },
		{ tag: t.special(t.variableName), color: colors.lavender },
		{ tag: [t.bool, t.number], color: config.number },
		{
			tag: [t.processingInstruction, t.string, t.inserted],
			color: config.string,
		},
		{ tag: t.invalid, color: config.invalid },
	]);

	return [theme, syntaxHighlighting(highlightStyle)];
}

export const themes = new Map(
	configs.map((config) => [config.name, createCatppuccinTheme(config)]),
);

export default themes;

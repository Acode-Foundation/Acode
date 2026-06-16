import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

export const config = {
	name: "gruvboxDark",
	dark: true,
	background: "#282828",
	foreground: "#ebdbb2",
	selection: "#928374",
	cursor: "#ebdbb2",
	dropdownBackground: "#3c3836",
	dropdownBorder: "#504945",
	activeLine: "#3c383633",
	lineNumber: "#7c6f64",
	lineNumberActive: "#ebdbb2",
	matchingBracket: "#928374",
	keyword: "#fb4934",
	variable: "#ebdbb2",
	parameter: "#ebdbb2",
	function: "#83a598",
	string: "#b8bb26",
	constant: "#d3869b",
	type: "#fabd2f",
	class: "#fabd2f",
	number: "#d3869b",
	comment: "#928374",
	heading: "#83a598",
	invalid: "#fb4934",
	regexp: "#8ec07c",
	tag: "#fe8019",
	operator: "#ebdbb2",
};

export const gruvboxDarkTheme = EditorView.theme(
	{
		"&": { color: config.foreground, backgroundColor: config.background },
		".cm-content": { caretColor: config.cursor },
		".cm-cursor, .cm-dropCursor": { borderLeftColor: config.cursor },
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
			backgroundColor: config.dropdownBackground,
			outline: `1px solid ${config.dropdownBorder}`,
		},
		".cm-searchMatch.cm-searchMatch-selected": {
			backgroundColor: config.selection,
		},
		".cm-activeLine": { backgroundColor: config.activeLine },
		".cm-selectionMatch": { backgroundColor: config.selection },
		"&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket": {
			backgroundColor: config.matchingBracket,
			color: config.background,
			outline: "none",
		},
		".cm-gutters": {
			backgroundColor: config.background,
			color: config.lineNumber,
			border: "none",
		},
		".cm-activeLineGutter": { backgroundColor: config.background },
		".cm-lineNumbers .cm-gutterElement": { color: config.lineNumber },
		".cm-lineNumbers .cm-activeLineGutter": { color: config.lineNumberActive },
		".cm-foldPlaceholder": {
			backgroundColor: "transparent",
			border: "none",
			color: config.foreground,
		},
		".cm-tooltip": {
			border: `1px solid ${config.dropdownBorder}`,
			backgroundColor: config.dropdownBackground,
			color: config.foreground,
		},
		".cm-tooltip-autocomplete": {
			"& > ul > li[aria-selected]": {
				background: config.selection,
				color: config.foreground,
			},
		},
	},
	{ dark: config.dark },
);

export const gruvboxDarkHighlightStyle = HighlightStyle.define([
	{ tag: t.keyword, color: config.keyword },
	{
		tag: [t.name, t.deleted, t.character, t.macroName],
		color: config.variable,
	},
	{ tag: [t.propertyName], color: config.variable },
	{
		tag: [t.processingInstruction, t.string, t.inserted, t.special(t.string)],
		color: config.string,
	},
	{ tag: [t.function(t.variableName), t.labelName], color: config.function },
	{
		tag: [t.color, t.constant(t.name), t.standard(t.name)],
		color: config.constant,
	},
	{ tag: [t.definition(t.name), t.separator], color: config.variable },
	{ tag: [t.className], color: config.class },
	{
		tag: [t.number, t.changed, t.annotation, t.modifier, t.self, t.namespace],
		color: config.number,
	},
	{ tag: [t.typeName], color: config.type },
	{ tag: [t.operator, t.operatorKeyword], color: config.operator },
	{
		tag: [t.url, t.escape, t.regexp, t.link, t.attributeName],
		color: config.regexp,
	},
	{ tag: [t.meta, t.comment], color: config.comment },
	{ tag: t.tagName, color: config.tag },
	{ tag: t.strong, fontWeight: "bold" },
	{ tag: t.emphasis, fontStyle: "italic" },
	{ tag: t.link, textDecoration: "underline" },
	{ tag: t.heading, fontWeight: "bold", color: config.heading },
	{ tag: [t.atom, t.bool, t.special(t.variableName)], color: config.constant },
	{ tag: t.invalid, color: config.invalid },
	{ tag: t.strikethrough, textDecoration: "line-through" },
]);

export function gruvboxDark() {
	return [gruvboxDarkTheme, syntaxHighlighting(gruvboxDarkHighlightStyle)];
}

export default gruvboxDark;

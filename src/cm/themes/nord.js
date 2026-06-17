import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

export const config = {
	name: "nord",
	dark: true,
	background: "#2e3440",
	foreground: "#d8dee9",
	selection: "#3b4252",
	cursor: "#f8f8f0",
	dropdownBackground: "#3b4252",
	dropdownBorder: "#434c5e",
	activeLine: "#3b425233",
	lineNumber: "#4c566a",
	lineNumberActive: "#d8dee9",
	matchingBracket: "#434c5e",
	keyword: "#81a1c1",
	variable: "#d8dee9",
	parameter: "#d8dee9",
	function: "#8fbcbb",
	string: "#a3be8c",
	constant: "#b48ead",
	type: "#88c0d0",
	class: "#8fbcbb",
	number: "#b48ead",
	comment: "#4c566a",
	heading: "#b48ead",
	invalid: "#bf616a",
	regexp: "#a3be8c",
	tag: "#bf616a",
	operator: "#81a1c1",
};

export const nordTheme = EditorView.theme(
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

export const nordHighlightStyle = HighlightStyle.define([
	{ tag: t.keyword, color: config.keyword },
	{
		tag: [t.name, t.deleted, t.character, t.macroName],
		color: config.variable,
	},
	{ tag: [t.propertyName, t.attributeName], color: config.function },
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
	{ tag: [t.url, t.escape, t.regexp, t.link], color: config.regexp },
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

export function nord() {
	return [nordTheme, syntaxHighlighting(nordHighlightStyle)];
}

export default nord;

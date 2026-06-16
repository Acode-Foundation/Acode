import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

export const config = {
	name: "ayuDark",
	dark: true,
	background: "#0a0e14",
	foreground: "#b3b1ad",
	selection: "#273747",
	cursor: "#e6b450",
	dropdownBackground: "#14191f",
	dropdownBorder: "#273747",
	activeLine: "#01060e33",
	lineNumber: "#3d424d",
	lineNumberActive: "#b3b1ad",
	matchingBracket: "#273747",
	keyword: "#ff8f40",
	variable: "#b3b1ad",
	parameter: "#f07178",
	function: "#ffee99",
	string: "#c2d94c",
	constant: "#e6b450",
	type: "#ff8f40",
	class: "#39bae6",
	number: "#e6b450",
	comment: "#626a73",
	heading: "#c2d94c",
	invalid: "#ff3333",
	regexp: "#39bae6",
	tag: "#39bae6",
	operator: "#f8f8f2",
};

export const ayuDarkTheme = EditorView.theme(
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

export const ayuDarkHighlightStyle = HighlightStyle.define([
	{ tag: t.keyword, color: config.keyword },
	{
		tag: [t.name, t.deleted, t.character, t.macroName],
		color: config.variable,
	},
	{ tag: [t.propertyName, t.attributeName], color: "#ffb454" },
	{
		tag: [t.processingInstruction, t.string, t.inserted, t.special(t.string)],
		color: config.string,
	},
	{ tag: [t.function(t.variableName), t.labelName], color: config.function },
	{
		tag: [t.color, t.constant(t.name), t.standard(t.name)],
		color: config.constant,
	},
	{ tag: [t.definition(t.name), t.separator], color: config.function },
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

export function ayuDark() {
	return [ayuDarkTheme, syntaxHighlighting(ayuDarkHighlightStyle)];
}

export default ayuDark;

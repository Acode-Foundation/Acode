import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

export const config = {
	name: "vscodeDark",
	dark: true,
	background: "#1e1e1e",
	foreground: "#9cdcfe",
	selection: "#6199ff2f",
	selectionMatch: "#72a1ff59",
	cursor: "#c6c6c6",
	dropdownBackground: "#1e1e1e",
	dropdownBorder: "#3c3c3c",
	activeLine: "#ffffff0f",
	lineNumber: "#838383",
	lineNumberActive: "#ffffff",
	matchingBracket: "#515c6a",
	keyword: "#569cd6",
	variable: "#9cdcfe",
	parameter: "#9cdcfe",
	function: "#dcdcaa",
	string: "#ce9178",
	constant: "#569cd6",
	type: "#4ec9b0",
	class: "#4ec9b0",
	number: "#b5cea8",
	comment: "#6a9955",
	heading: "#9cdcfe",
	invalid: "#ff0000",
	regexp: "#d16969",
	tag: "#4ec9b0",
	operator: "#d4d4d4",
	angleBracket: "#808080",
};

export const vscodeDarkTheme = EditorView.theme(
	{
		"&": {
			color: config.foreground,
			backgroundColor: config.background,
		},

		".cm-content": { caretColor: config.cursor },

		".cm-cursor, .cm-dropCursor": { borderLeftColor: config.cursor },
		"&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
			{
				backgroundColor: config.selection,
			},

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
			backgroundColor: config.selectionMatch,
		},

		".cm-activeLine": { backgroundColor: config.activeLine },
		".cm-selectionMatch": { backgroundColor: config.selectionMatch },

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
		".cm-tooltip .cm-tooltip-arrow:before": {
			borderTopColor: "transparent",
			borderBottomColor: "transparent",
		},
		".cm-tooltip .cm-tooltip-arrow:after": {
			borderTopColor: config.foreground,
			borderBottomColor: config.foreground,
		},
		".cm-tooltip-autocomplete": {
			"& > ul > li[aria-selected]": {
				background: config.selectionMatch,
				color: config.foreground,
			},
		},
	},
	{ dark: config.dark },
);

export const vscodeDarkHighlightStyle = HighlightStyle.define([
	{
		tag: [
			t.keyword,
			t.operatorKeyword,
			t.modifier,
			t.color,
			t.constant(t.name),
			t.standard(t.name),
			t.standard(t.tagName),
			t.special(t.brace),
			t.atom,
			t.bool,
			t.special(t.variableName),
		],
		color: config.keyword,
	},
	{ tag: [t.controlKeyword, t.moduleKeyword], color: "#c586c0" },
	{
		tag: [
			t.name,
			t.deleted,
			t.character,
			t.macroName,
			t.propertyName,
			t.variableName,
			t.labelName,
			t.definition(t.name),
		],
		color: config.variable,
	},
	{ tag: t.heading, fontWeight: "bold", color: config.heading },
	{
		tag: [
			t.typeName,
			t.className,
			t.tagName,
			t.number,
			t.changed,
			t.annotation,
			t.self,
			t.namespace,
		],
		color: config.type,
	},
	{
		tag: [t.function(t.variableName), t.function(t.propertyName)],
		color: config.function,
	},
	{ tag: [t.number], color: config.number },
	{
		tag: [t.operator, t.punctuation, t.separator, t.url, t.escape, t.regexp],
		color: config.operator,
	},
	{ tag: [t.regexp], color: config.regexp },
	{
		tag: [t.special(t.string), t.processingInstruction, t.string, t.inserted],
		color: config.string,
	},
	{ tag: [t.angleBracket], color: config.angleBracket },
	{ tag: t.strong, fontWeight: "bold" },
	{ tag: t.emphasis, fontStyle: "italic" },
	{ tag: t.strikethrough, textDecoration: "line-through" },
	{ tag: [t.meta, t.comment], color: config.comment },
	{ tag: t.link, color: config.comment, textDecoration: "underline" },
	{ tag: t.invalid, color: config.invalid },
]);

export function vscodeDark() {
	return [vscodeDarkTheme, syntaxHighlighting(vscodeDarkHighlightStyle)];
}

export default vscodeDark;

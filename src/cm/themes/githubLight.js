import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView, lineNumbers } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

export const config = {
	name: "githubLight",
	dark: false,
	background: "#fff",
	foreground: "#444d56",
	selection: "#0366d625",
	cursor: "#044289",
	dropdownBackground: "#fff",
	dropdownBorder: "#e1e4e8",
	activeLine: "#c6c6c622",
	lineNumber: "#1b1f234d",
	lineNumberActive: "#24292e",
	matchingBracket: "#34d05840",
	keyword: "#d73a49",
	storage: "#d73a49",
	variable: "#e36209",
	parameter: "#24292e",
	function: "#005cc5",
	string: "#032f62",
	constant: "#005cc5",
	type: "#005cc5",
	class: "#6f42c1",
	number: "#005cc5",
	comment: "#6a737d",
	heading: "#005cc5",
	invalid: "#cb2431",
	regexp: "#032f62",
};

export const githubLightTheme = EditorView.theme(
	{
		"&": {
			color: config.foreground,
			backgroundColor: config.background,
		},

		".cm-content": { caretColor: config.cursor },

		".cm-cursor, .cm-dropCursor": { borderLeftColor: config.cursor },
		"&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
			{ backgroundColor: config.selection },

		".cm-panels": {
			backgroundColor: config.dropdownBackground,
			color: config.foreground,
		},
		".cm-panels.cm-panels-top": { borderBottom: "2px solid black" },
		".cm-panels.cm-panels-bottom": { borderTop: "2px solid black" },

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
			color: config.foreground,
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
				background: config.selection,
				color: config.foreground,
			},
		},
	},
	{ dark: config.dark },
);

export const githubLightHighlightStyle = HighlightStyle.define([
	{ tag: t.keyword, color: config.keyword },
	{
		tag: [t.name, t.deleted, t.character, t.macroName],
		color: config.variable,
	},
	{ tag: [t.propertyName], color: config.function },
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
	{ tag: [t.typeName], color: config.type, fontStyle: config.type },
	{ tag: [t.operator, t.operatorKeyword], color: config.keyword },
	{ tag: [t.url, t.escape, t.regexp, t.link], color: config.regexp },
	{ tag: [t.meta, t.comment], color: config.comment },
	{ tag: t.strong, fontWeight: "bold" },
	{ tag: t.emphasis, fontStyle: "italic" },
	{ tag: t.link, textDecoration: "underline" },
	{ tag: t.heading, fontWeight: "bold", color: config.heading },
	{ tag: [t.atom, t.bool, t.special(t.variableName)], color: config.variable },
	{ tag: t.invalid, color: config.invalid },
	{ tag: t.strikethrough, textDecoration: "line-through" },
]);

export function githubLight() {
	return [githubLightTheme, syntaxHighlighting(githubLightHighlightStyle)];
}

export default githubLight;

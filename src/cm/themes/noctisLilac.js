import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

export const config = {
	name: "noctisLilac",
	dark: false,
	background: "#f2f1f8",
	foreground: "#0c006b",
	selection: "#d5d1f2",
	cursor: "#5c49e9",
	dropdownBackground: "#f2f1f8",
	dropdownBorder: "#e1def3",
	activeLine: "#e1def3",
	lineNumber: "#0c006b70",
	lineNumberActive: "#0c006b",
	matchingBracket: "#d5d1f2",
	keyword: "#ff5792",
	storage: "#ff5792",
	variable: "#0c006b",
	parameter: "#0c006b",
	function: "#0095a8",
	string: "#00b368",
	constant: "#5842ff",
	type: "#b3694d",
	class: "#0094f0",
	number: "#5842ff",
	comment: "#9995b7",
	heading: "#0094f0",
	invalid: "#ff5792",
	regexp: "#00b368",
};

export const noctisLilacTheme = EditorView.theme(
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

export const noctisLilacHighlightStyle = HighlightStyle.define([
	{ tag: t.comment, color: config.comment },
	{ tag: t.keyword, color: config.keyword, fontWeight: "bold" },
	{ tag: [t.definitionKeyword, t.modifier], color: config.keyword },
	{
		tag: [t.className, t.tagName, t.definition(t.typeName)],
		color: config.class,
	},
	{ tag: [t.number, t.bool, t.null, t.special(t.brace)], color: config.number },
	{
		tag: [t.definition(t.propertyName), t.function(t.variableName)],
		color: config.function,
	},
	{ tag: t.typeName, color: config.type },
	{ tag: [t.propertyName, t.variableName], color: "#fa8900" },
	{ tag: t.operator, color: config.keyword },
	{ tag: t.self, color: "#e64100" },
	{ tag: [t.string, t.regexp], color: config.string },
	{ tag: [t.paren, t.bracket], color: "#0431fa" },
	{ tag: t.labelName, color: "#00bdd6" },
	{ tag: t.attributeName, color: "#e64100" },
	{ tag: t.angleBracket, color: config.comment },
]);

export function noctisLilac() {
	return [noctisLilacTheme, syntaxHighlighting(noctisLilacHighlightStyle)];
}

export default noctisLilac;

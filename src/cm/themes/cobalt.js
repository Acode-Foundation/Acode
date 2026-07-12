import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

export const config = {
	name: "cobalt",
	dark: true,
	background: "#002240",
	foreground: "#ffffff",
	selection: "#b3653966",
	cursor: "#ffffff",
	dropdownBackground: "#001b33",
	dropdownBorder: "#0088ff",
	activeLine: "#ffffff0d",
	lineNumber: "#7285b7",
	lineNumberActive: "#ffffff",
	matchingBracket: "#00aaff66",
	keyword: "#ffee80",
	storage: "#ff9d00",
	variable: "#ffffff",
	parameter: "#ffffff",
	function: "#ffc600",
	string: "#3ad900",
	constant: "#ff628c",
	type: "#80ffbb",
	class: "#80ffbb",
	number: "#ff628c",
	comment: "#0088ff",
	heading: "#ffc600",
	invalid: "#f8f8f8",
	regexp: "#80ffc2",
};

export const cobaltTheme = EditorView.theme(
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
			backgroundColor: config.matchingBracket,
			outline: `1px solid ${config.dropdownBorder}`,
		},
		".cm-searchMatch.cm-searchMatch-selected, .cm-selectionMatch": {
			backgroundColor: config.selection,
		},
		".cm-activeLine": { backgroundColor: config.activeLine },
		"&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket": {
			backgroundColor: config.matchingBracket,
		},
		".cm-gutters": {
			backgroundColor: config.background,
			color: config.lineNumber,
			border: "none",
		},
		".cm-activeLineGutter": { backgroundColor: config.activeLine },
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
		".cm-tooltip-autocomplete > ul > li[aria-selected]": {
			background: config.selection,
			color: config.foreground,
		},
	},
	{ dark: config.dark },
);

export const cobaltHighlightStyle = HighlightStyle.define([
	{ tag: t.keyword, color: config.keyword },
	{ tag: [t.modifier, t.definitionKeyword], color: config.storage },
	{
		tag: [t.name, t.deleted, t.character, t.macroName],
		color: config.variable,
	},
	{
		tag: [t.propertyName, t.function(t.variableName), t.labelName],
		color: config.function,
	},
	{
		tag: [t.processingInstruction, t.string, t.inserted, t.special(t.string)],
		color: config.string,
	},
	{
		tag: [t.color, t.constant(t.name), t.standard(t.name), t.atom, t.bool],
		color: config.constant,
	},
	{ tag: [t.className, t.typeName], color: config.type },
	{
		tag: [t.number, t.changed, t.annotation, t.self, t.namespace],
		color: config.number,
	},
	{ tag: [t.operator, t.operatorKeyword], color: config.keyword },
	{ tag: [t.url, t.escape, t.regexp, t.link], color: config.regexp },
	{ tag: [t.meta, t.comment], color: config.comment, fontStyle: "italic" },
	{ tag: t.strong, fontWeight: "bold" },
	{ tag: t.emphasis, fontStyle: "italic" },
	{ tag: t.link, textDecoration: "underline" },
	{ tag: t.heading, fontWeight: "bold", color: config.heading },
	{ tag: t.invalid, color: config.invalid, backgroundColor: "#ff0000" },
	{ tag: t.strikethrough, textDecoration: "line-through" },
]);

export function cobalt() {
	return [cobaltTheme, syntaxHighlighting(cobaltHighlightStyle)];
}

export default cobalt;

import { closeBrackets, completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import {
	bracketMatching,
	defaultHighlightStyle,
	foldGutter,
	indentOnInput,
	syntaxHighlighting,
} from "@codemirror/language";
import { highlightSelectionMatches } from "@codemirror/search";
import type { Extension } from "@codemirror/state";
import { EditorState } from "@codemirror/state";
import {
	crosshairCursor,
	drawSelection,
	dropCursor,
	highlightActiveLine,
	highlightActiveLineGutter,
	highlightSpecialChars,
	keymap,
	rectangularSelection,
	tooltips,
} from "@codemirror/view";

/**
 * Base extensions roughly matching the useful parts of CodeMirror's basicSetup
 */
export default function createBaseExtensions(): Extension[] {
	return [
		highlightActiveLineGutter(),
		highlightSpecialChars(),
		history(),
		foldGutter(),
		drawSelection(),
		dropCursor(),
		EditorState.allowMultipleSelections.of(true),
		indentOnInput(),
		syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
		bracketMatching(),
		closeBrackets(),
		rectangularSelection(),
		crosshairCursor(),
		highlightActiveLine(),
		highlightSelectionMatches(),
		keymap.of([...completionKeymap, ...defaultKeymap, ...historyKeymap]),
		// This prevents tooltips from being going out of the editor area
		tooltips({
			tooltipSpace: (view) => {
				const rect = view.dom.getBoundingClientRect();
				return {
					top: rect.top,
					left: rect.left,
					bottom: window.innerHeight,
					right: window.innerWidth,
				};
			},
		}),
	];
}

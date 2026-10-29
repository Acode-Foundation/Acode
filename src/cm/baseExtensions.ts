import {
	acceptCompletion,
	closeBrackets,
	closeBracketsKeymap,
	completionKeymap,
} from "@codemirror/autocomplete";
import { history } from "@codemirror/commands";
import {
	bracketMatching,
	codeFolding as codeFoldingState,
	defaultHighlightStyle,
	foldGutter,
	indentOnInput,
	syntaxHighlighting,
} from "@codemirror/language";
import { highlightSelectionMatches } from "@codemirror/search";
import type { Extension } from "@codemirror/state";
import { EditorState, Prec } from "@codemirror/state";
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
import indentationFolding from "./indentationFolding";

export interface BaseExtensionOptions {
	autoIndent?: boolean;
	codeFolding?: boolean;
	/**
	 * Show CodeMirror's fold gutter with code folding. The canvas renderer
	 * draws its own fold markers, so it only needs the folding state.
	 */
	foldGutter?: boolean;
	/**
	 * The canvas renderer draws the selection, cursors, drop cursor, active
	 * line (and its gutter) and special characters itself, so those
	 * extensions are left out.
	 */
	canvas?: boolean;
	autoCloseBrackets?: boolean;
	bracketMatching?: boolean;
	highlightActiveLine?: boolean;
	highlightSelectionMatches?: boolean;
}

/**
 * Base extensions roughly matching the useful parts of CodeMirror's basicSetup
 */
export default function createBaseExtensions(
	options: BaseExtensionOptions = {},
): Extension[] {
	const {
		autoIndent = true,
		codeFolding = true,
		foldGutter: showFoldGutter = true,
		canvas = false,
		autoCloseBrackets = true,
		bracketMatching: enableBracketMatching = true,
		highlightActiveLine: enableHighlightActiveLine = true,
		highlightSelectionMatches: enableHighlightSelectionMatches = true,
	} = options;
	const extensions: Extension[] = [history()];
	if (!canvas) extensions.push(highlightSpecialChars());

	if (enableHighlightActiveLine && !canvas) {
		extensions.push(highlightActiveLineGutter());
	}
	if (codeFolding) {
		extensions.push(
			showFoldGutter ? foldGutter() : codeFoldingState(),
			indentationFolding,
		);
	}
	if (!canvas) extensions.push(drawSelection(), dropCursor());
	extensions.push(EditorState.allowMultipleSelections.of(true));
	if (autoIndent) extensions.push(indentOnInput());
	extensions.push(
		syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
	);
	if (enableBracketMatching) extensions.push(bracketMatching());
	if (autoCloseBrackets) extensions.push(closeBrackets());
	extensions.push(rectangularSelection());
	extensions.push(crosshairCursor());
	if (enableHighlightActiveLine && !canvas) {
		extensions.push(highlightActiveLine());
	}
	if (enableHighlightSelectionMatches) {
		extensions.push(highlightSelectionMatches());
	}
	extensions.push(
		Prec.highest(keymap.of([{ key: "Tab", run: acceptCompletion }])),
	);
	extensions.push(
		keymap.of([
			...(autoCloseBrackets ? closeBracketsKeymap : []),
			...completionKeymap,
		]),
	);
	extensions.push(
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
	);

	return extensions;
}

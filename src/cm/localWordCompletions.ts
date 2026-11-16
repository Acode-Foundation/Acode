import { completeWords, wordIndex } from "@acode.app/canvas-view";
import {
	type CompletionSource,
	completeAnyWord,
} from "@codemirror/autocomplete";
import { EditorState, type Extension } from "@codemirror/state";
import { isCanvasView } from "cm/createEditorView";

/**
 * Words from the document. Canvas editors answer from canvas-view's word
 * index, which recounts only the changed lines, ranks words near the
 * cursor first and returns at most 200 matches: CodeMirror's
 * `completeAnyWord` re-merges a big file's word lists on every query (its
 * per-node cache only holds nodes with under 2000 words) and returns every
 * distinct word, ~35ms per query in a 4MB file on a 2GB phone against
 * ~2ms. The DOM editor keeps CodeMirror's.
 */
export const localWordCompletionSource: CompletionSource = (context) =>
	isCanvasView(context.view)
		? completeWords(context)
		: completeAnyWord(context);

export default function localWordCompletions(): Extension {
	return [
		EditorState.languageData.of(() => [
			{ autocomplete: localWordCompletionSource },
		]),
		// Idle until a canvas editor asks for completions, so it costs
		// nothing in DOM editors.
		wordIndex(),
	];
}

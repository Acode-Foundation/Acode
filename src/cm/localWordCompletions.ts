import {
	completeAnyWord,
	type CompletionSource,
} from "@codemirror/autocomplete";
import { EditorState, type Extension } from "@codemirror/state";

export const localWordCompletionSource: CompletionSource = completeAnyWord;

export default function localWordCompletions(): Extension {
	return EditorState.languageData.of(() => [
		{ autocomplete: localWordCompletionSource },
	]);
}

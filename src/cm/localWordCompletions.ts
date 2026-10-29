import {
	type CompletionSource,
	completeAnyWord,
} from "@codemirror/autocomplete";
import { EditorState, type Extension } from "@codemirror/state";

export const localWordCompletionSource: CompletionSource = completeAnyWord;

export default function localWordCompletions(): Extension {
	return EditorState.languageData.of(() => [
		{ autocomplete: localWordCompletionSource },
	]);
}

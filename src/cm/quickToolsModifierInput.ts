import type { Extension } from "@codemirror/state";
import { EditorView, type EditorView as CodeMirrorEditorView } from "@codemirror/view";

type QuickToolsModifierInputHandler = (
	view: CodeMirrorEditorView,
	text: string,
) => boolean | void;

let handleTextInput: QuickToolsModifierInputHandler = () => false;

export function setQuickToolsModifierInputHandler(
	handler: QuickToolsModifierInputHandler,
): void {
	handleTextInput = typeof handler === "function" ? handler : () => false;
}

export default function quickToolsModifierInput(): Extension {
	return EditorView.inputHandler.of((view, _from, _to, text) => {
		return !!handleTextInput(view, text);
	});
}

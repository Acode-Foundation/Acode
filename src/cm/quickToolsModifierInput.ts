import type { Extension } from "@codemirror/state";
import {
	EditorView,
	type EditorView as CodeMirrorEditorView,
} from "@codemirror/view";
import { blurEditorIfReadOnly, focusEditorIfEditable } from "cm/editorReadOnly";

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

export function canQuickToolsEdit(view: CodeMirrorEditorView): boolean {
	return !view.state.readOnly;
}

/** Use the capture input for read-only shortcuts without focusing the editor. */
export function focusQuickToolsModifierInput(
	view: CodeMirrorEditorView,
	captureInput: HTMLElement,
): boolean {
	if (!view.state.readOnly) {
		focusEditorIfEditable(view);
		return false;
	}
	blurEditorIfReadOnly(view, true);
	captureInput.focus();
	return true;
}

/** Close a read-only shortcut capture without disturbing intentional UI focus. */
export function finishQuickToolsModifierInput(
	view: CodeMirrorEditorView,
	captureInput: HTMLElement,
): boolean {
	if (!view.state.readOnly) return false;
	captureInput.blur();
	blurEditorIfReadOnly(view, true);
	return true;
}

export default function quickToolsModifierInput(): Extension {
	return EditorView.inputHandler.of((view, _from, _to, text) => {
		const handled = !!handleTextInput(view, text);
		return view.state.readOnly || handled;
	});
}

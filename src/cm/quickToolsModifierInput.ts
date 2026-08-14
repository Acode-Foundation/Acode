import type { Extension } from "@codemirror/state";
import {
	EditorView,
	type EditorView as CodeMirrorEditorView,
} from "@codemirror/view";

export interface QuickToolsModifierInputContext {
	from: number;
	to: number;
	text: string;
}

type QuickToolsModifierInputHandler = (
	view: CodeMirrorEditorView,
	input: QuickToolsModifierInputContext,
) => boolean | void;

let handleTextInput: QuickToolsModifierInputHandler = () => false;

export function setQuickToolsModifierInputHandler(
	handler: QuickToolsModifierInputHandler,
): void {
	handleTextInput = typeof handler === "function" ? handler : () => false;
}

/**
 * Android may report typing over a selection as an empty deletion followed by
 * a separate insertion. Quick-tools modifiers must hold that deletion until
 * the character arrives, otherwise shortcuts such as Ctrl+C copy only after
 * the selected text has already been removed.
 */
export function isSelectedRangeDeletion(
	view: CodeMirrorEditorView,
	input: QuickToolsModifierInputContext,
): boolean {
	const selection = view?.state?.selection?.main;
	if (!selection || selection.empty || input.text !== "") return false;
	return input.from <= selection.from && input.to >= selection.to;
}

export default function quickToolsModifierInput(): Extension {
	return EditorView.inputHandler.of((view, from, to, text) => {
		// When a DOM-derived input is handled without changing state, CodeMirror's
		// DOM observer performs its own view.update([]) reconciliation. Dispatching
		// here would make that observer think state changed and can leave Android's
		// native replacement in the content DOM.
		return !!handleTextInput(view, { from, to, text });
	});
}

// @vitest-environment happy-dom

import { selectAll } from "@codemirror/commands";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { createEditorReadOnlyExtension } from "cm/editorReadOnly";
import quickToolsModifierInput, {
	canQuickToolsEdit,
	finishQuickToolsModifierInput,
	focusQuickToolsModifierInput,
	setQuickToolsModifierInputHandler,
} from "cm/quickToolsModifierInput";
import { runQuickToolKey } from "cm/quickToolsNavigation";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("utils/keyboardEvent", () => ({
	default: (type: string, init: KeyboardEventInit) =>
		new KeyboardEvent(type, init),
}));

const views: EditorView[] = [];

afterEach(() => {
	setQuickToolsModifierInputHandler(() => false);
	while (views.length) views.pop()?.destroy();
	document.body.replaceChildren();
});

function createEditor(readOnly: boolean, extensions = []) {
	const state = EditorState.create({
		doc: "alpha beta",
		extensions: [createEditorReadOnlyExtension(readOnly), ...extensions],
	});
	const view = new EditorView({ state, parent: document.body });
	views.push(view);
	return view;
}

describe("read-only QuickTools interaction", () => {
	it("selects all without focusing or changing the document", () => {
		const view = createEditor(true, [
			keymap.of([{ key: "Ctrl-a", run: selectAll }]),
		]);
		const originalDocument = view.state.doc.toString();

		expect(runQuickToolKey(view, 65, { ctrlKey: true })).toBe(true);
		expect(view.state.selection.main.from).toBe(0);
		expect(view.state.selection.main.to).toBe(view.state.doc.length);
		expect(view.state.doc.toString()).toBe(originalDocument);
		expect(view.hasFocus).toBe(false);
	});

	it("allows selection navigation but blocks deletion", () => {
		const view = createEditor(true);
		view.dispatch({ selection: EditorSelection.cursor(0) });

		expect(runQuickToolKey(view, 39, { shiftKey: true })).toBe(true);
		expect(view.state.selection.main.to).toBe(1);
		const originalDocument = view.state.doc.toString();
		expect(runQuickToolKey(view, 8)).toBe(false);
		expect(view.state.doc.toString()).toBe(originalDocument);
		expect(view.hasFocus).toBe(false);
	});

	it("uses and dismisses the capture input for read-only shortcuts", () => {
		const view = createEditor(true);
		const captureInput = document.createElement("input");
		document.body.append(captureInput);

		expect(focusQuickToolsModifierInput(view, captureInput)).toBe(true);
		expect(document.activeElement).toBe(captureInput);
		expect(view.hasFocus).toBe(false);
		expect(finishQuickToolsModifierInput(view, captureInput)).toBe(true);
		expect(document.activeElement).not.toBe(captureInput);
		expect(view.hasFocus).toBe(false);
	});

	it("preserves ordinary editable focus behavior", () => {
		const view = createEditor(false);
		const captureInput = document.createElement("input");
		document.body.append(captureInput);

		expect(canQuickToolsEdit(view)).toBe(true);
		expect(focusQuickToolsModifierInput(view, captureInput)).toBe(false);
		expect(view.hasFocus).toBe(true);
		expect(finishQuickToolsModifierInput(view, captureInput)).toBe(false);
		expect(view.hasFocus).toBe(true);
	});

	it("consumes leaked text input in read-only mode", () => {
		const handler = vi.fn(() => false);
		setQuickToolsModifierInputHandler(handler);
		const view = createEditor(true, [quickToolsModifierInput()]);
		const inputHandlers = view.state.facet(EditorView.inputHandler);
		const quickToolsHandler = inputHandlers.at(-1);

		expect(quickToolsHandler?.(view, 0, 0, "X", () => null)).toBe(true);
		expect(handler).toHaveBeenCalledWith(view, "X");
		expect(view.state.doc.toString()).toBe("alpha beta");
	});

	it("the user-change filter prevents selected text replacement", () => {
		const view = createEditor(true);
		view.dispatch({ selection: EditorSelection.range(0, 5) });
		view.dispatch({
			...view.state.replaceSelection("X"),
			userEvent: "input.quicktools",
		});

		expect(view.state.doc.toString()).toBe("alpha beta");
		expect(view.state.selection.main.from).toBe(0);
		expect(view.state.selection.main.to).toBe(5);
	});
});

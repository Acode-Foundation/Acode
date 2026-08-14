// @vitest-environment happy-dom

import { javascript } from "@codemirror/lang-javascript";
import {
	defaultHighlightStyle,
	syntaxHighlighting,
} from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import quickToolsModifierInput, {
	isSelectedRangeDeletion,
	setQuickToolsModifierInputHandler,
	type QuickToolsModifierInputContext,
} from "cm/quickToolsModifierInput";

function createView(
	doc = "abcdef",
	selection = { anchor: 1, head: 4 },
	extraExtensions = [],
) {
	const parent = document.createElement("div");
	document.body.append(parent);
	const state = EditorState.create({
		doc,
		selection,
		extensions: [quickToolsModifierInput(), ...extraExtensions],
	});
	const view = new EditorView({ state, parent });
	return { view, parent };
}

function applyInput(
	view: EditorView,
	input: QuickToolsModifierInputContext,
): boolean {
	const defaultInsert = () =>
		view.state.update({
			changes: {
				from: input.from,
				to: input.to,
				insert: input.text,
			},
			selection: { anchor: input.from + input.text.length },
		});
	const handled = view.state
		.facet(EditorView.inputHandler)
		.some((handler) =>
			handler(
				view,
				input.from,
				input.to,
				input.text,
				defaultInsert,
			),
		);
	if (!handled) view.dispatch(defaultInsert());
	return handled;
}

afterEach(() => {
	setQuickToolsModifierInputHandler(() => false);
	document.body.replaceChildren();
});

describe("quick-tools modifier input", () => {
	it("recognizes only empty changes that cover the active selection", () => {
		const { view } = createView();

		expect(
			isSelectedRangeDeletion(view, { from: 1, to: 4, text: "" }),
		).toBe(true);
		expect(
			isSelectedRangeDeletion(view, { from: 2, to: 4, text: "" }),
		).toBe(false);
		expect(
			isSelectedRangeDeletion(view, { from: 1, to: 4, text: "c" }),
		).toBe(false);

		view.dispatch({ selection: { anchor: 2 } });
		expect(
			isSelectedRangeDeletion(view, { from: 1, to: 4, text: "" }),
		).toBe(false);
		view.destroy();
	});

	it("preserves selection across Android delete-then-copy input", () => {
		const doc = 'import { history } from "@codemirror/commands";';
		const { view } = createView(doc, { anchor: 0, head: doc.length });
		let ctrlArmed = true;
		let copied = "";

		setQuickToolsModifierInputHandler((target, input) => {
			if (!ctrlArmed) return false;
			if (isSelectedRangeDeletion(target, input)) return true;
			if (input.text !== "c") return false;
			copied = target.state.sliceDoc(
				target.state.selection.main.from,
				target.state.selection.main.to,
			);
			ctrlArmed = false;
			return true;
		});

		expect(applyInput(view, { from: 0, to: doc.length, text: "" })).toBe(
			true,
		);
		expect(view.state.doc.toString()).toBe(doc);
		expect(view.state.selection.main.from).toBe(0);
		expect(view.state.selection.main.to).toBe(doc.length);
		expect(ctrlArmed).toBe(true);

		expect(applyInput(view, { from: 0, to: doc.length, text: "c" })).toBe(
			true,
		);
		expect(copied).toBe(doc);
		expect(view.state.doc.toString()).toBe(doc);
		expect(view.state.selection.main.from).toBe(0);
		expect(view.state.selection.main.to).toBe(doc.length);
		expect(ctrlArmed).toBe(false);
		view.destroy();
	});

	it("lets CodeMirror restore a handled syntax-highlighted DOM replacement", async () => {
		const doc = 'import { history } from "@codemirror/commands";';
		const from = doc.indexOf("codemirror");
		const to = from + "codemirror".length;
		const { view } = createView(doc, { anchor: from, head: to }, [
			javascript(),
			syntaxHighlighting(defaultHighlightStyle),
		]);
		let receivedInput: QuickToolsModifierInputContext | null = null;
		setQuickToolsModifierInputHandler((_target, input) => {
			receivedInput = input;
			return true;
		});
		view.focus();
		await new Promise((resolve) => setTimeout(resolve, 10));
		const startState = view.state;
		const stringSpan = Array.from(view.contentDOM.querySelectorAll("span")).find(
			(element) => element.textContent?.includes("codemirror"),
		);
		const textNode = stringSpan?.firstChild;
		expect(textNode).not.toBeNull();

		if (textNode) textNode.nodeValue = '"@c/commands"';
		await new Promise((resolve) => setTimeout(resolve, 20));

		expect(receivedInput).toEqual({ from, to, text: "c" });
		expect(view.state).toBe(startState);
		expect(view.state.doc.toString()).toBe(doc);
		expect(view.contentDOM.textContent).toBe(doc);
		expect(view.state.selection.main.from).toBe(from);
		expect(view.state.selection.main.to).toBe(to);
		view.destroy();
	});

	it("does not add an extra transaction after an editing command", () => {
		const updates = [];
		const { view } = createView("abcdef", { anchor: 1, head: 4 }, [
			EditorView.updateListener.of((update) => updates.push(update)),
		]);
		setQuickToolsModifierInputHandler((target, input) => {
			target.dispatch({
				changes: { from: input.from, to: input.to, insert: "" },
				selection: { anchor: input.from },
			});
			return true;
		});

		expect(applyInput(view, { from: 1, to: 4, text: "x" })).toBe(true);
		expect(view.state.doc.toString()).toBe("aef");
		expect(updates).toHaveLength(1);
		view.destroy();
	});

	it("allows normal unmodified deletion and typing", () => {
		const { view } = createView();
		setQuickToolsModifierInputHandler(() => false);

		expect(applyInput(view, { from: 1, to: 4, text: "" })).toBe(false);
		expect(view.state.doc.toString()).toBe("aef");
		expect(applyInput(view, { from: 1, to: 1, text: "z" })).toBe(false);
		expect(view.state.doc.toString()).toBe("azef");
		view.destroy();
	});
});

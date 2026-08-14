// @vitest-environment happy-dom

import { Compartment, EditorSelection, EditorState } from "@codemirror/state";
import { drawSelection, EditorView } from "@codemirror/view";
import {
	createEditorReadOnlyExtension,
	focusEditorIfEditable,
	isReadOnlyUserChange,
	placeReadOnlyCursor,
	reconfigureEditorReadOnly,
	resolveReadOnlyContextSelection,
	shouldCommitReadOnlyTap,
} from "cm/editorReadOnly";
import { afterEach, describe, expect, it } from "vitest";

const views: EditorView[] = [];

afterEach(() => {
	while (views.length) views.pop()?.destroy();
	document.body.replaceChildren();
});

function createEditor(readOnly = false, doc = "read only content") {
	const compartment = new Compartment();
	const state = EditorState.create({
		doc,
		extensions: [
			drawSelection(),
			compartment.of(createEditorReadOnlyExtension(readOnly)),
		],
	});
	const view = new EditorView({ state, parent: document.body });
	views.push(view);
	return { compartment, view };
}

function expectEditable(view: EditorView) {
	expect(view.state.readOnly).toBe(false);
	expect(view.state.facet(EditorView.editable)).toBe(true);
	expect(view.contentDOM.getAttribute("contenteditable")).toBe("true");
	expect(view.contentDOM.hasAttribute("aria-readonly")).toBe(false);
	expect(view.contentDOM.hasAttribute("tabindex")).toBe(false);
	expect(view.dom.classList.contains("cm-read-only")).toBe(false);
}

function expectReadOnly(view: EditorView) {
	expect(view.state.readOnly).toBe(true);
	expect(view.state.facet(EditorView.editable)).toBe(false);
	expect(view.contentDOM.getAttribute("contenteditable")).toBe("false");
	expect(view.contentDOM.getAttribute("aria-readonly")).toBe("true");
	expect(view.contentDOM.hasAttribute("tabindex")).toBe(false);
	expect(view.dom.classList.contains("cm-read-only")).toBe(true);
}

describe("editor read-only configuration", () => {
	it("keeps an editable editor focusable for text input", () => {
		const { view } = createEditor();

		expectEditable(view);
		view.focus();
		expect(view.hasFocus).toBe(true);
	});

	it("uses a non-editable DOM while preserving state selection", () => {
		const { view } = createEditor(true);
		const originalDocument = view.state.doc.toString();

		expectReadOnly(view);
		view.dispatch({ selection: EditorSelection.range(0, 4) });
		expect(view.state.selection.main.from).toBe(0);
		expect(view.state.selection.main.to).toBe(4);
		expect(view.state.doc.toString()).toBe(originalDocument);
	});

	it("reveals CodeMirror's static cursor only in read-only mode", () => {
		const { compartment, view } = createEditor(true);
		const cursorLayer = view.dom.querySelector<HTMLElement>(".cm-cursorLayer");
		expect(cursorLayer).not.toBeNull();
		const cursor = document.createElement("span");
		cursor.className = "cm-cursor cm-cursor-primary";
		cursorLayer!.append(cursor);

		expect(getComputedStyle(cursor).display).toBe("block");
		expect(view.hasFocus).toBe(false);

		reconfigureEditorReadOnly(view, compartment, false);
		expect(view.dom.classList.contains("cm-read-only")).toBe(false);
		expect(getComputedStyle(cursor).display).toBe("none");
	});

	it("blocks user document changes but permits internal synchronization", () => {
		const { view } = createEditor(true);
		view.dispatch({ selection: EditorSelection.range(0, 4) });
		view.dispatch({
			changes: { from: 0, to: 4, insert: "EDIT" },
			userEvent: "input.quicktools",
		});
		expect(view.state.doc.toString()).toBe("read only content");
		expect([
			view.state.selection.main.from,
			view.state.selection.main.to,
		]).toEqual([0, 4]);

		view.dispatch({ changes: { from: 0, to: 4, insert: "SYNC" } });
		expect(view.state.doc.toString()).toBe("SYNC only content");
	});

	it("classifies only editing user events as read-only mutations", () => {
		expect(isReadOnlyUserChange("input.quicktools")).toBe(true);
		expect(isReadOnlyUserChange("delete.backward")).toBe(true);
		expect(isReadOnlyUserChange("undo")).toBe(true);
		expect(isReadOnlyUserChange("select.pointer")).toBe(false);
		expect(isReadOnlyUserChange(undefined)).toBe(false);
	});

	it("rejects later focus attempts and never restores read-only focus", () => {
		const { view } = createEditor(true);
		view.focus();
		expect(view.hasFocus).toBe(false);
		focusEditorIfEditable(view);
		expect(view.hasFocus).toBe(false);
	});

	it("blurs on entry and fully restores editable mode", () => {
		const { compartment, view } = createEditor();
		view.focus();
		expect(view.hasFocus).toBe(true);

		reconfigureEditorReadOnly(view, compartment, true);
		expectReadOnly(view);
		expect(view.hasFocus).toBe(false);

		reconfigureEditorReadOnly(view, compartment, false);
		expectEditable(view);
		view.focus();
		expect(view.hasFocus).toBe(true);
	});

	it("restores focus after selection actions only for editable files", () => {
		const readOnly = createEditor(true).view;
		const editable = createEditor(false).view;

		focusEditorIfEditable(readOnly);
		expect(readOnly.hasFocus).toBe(false);
		focusEditorIfEditable(editable);
		expect(editable.hasFocus).toBe(true);
	});

	it("places a read-only cursor without editing or focusing", () => {
		const { view } = createEditor(true);
		view.dispatch({ selection: EditorSelection.range(0, 4) });
		const originalDocument = view.state.doc.toString();

		expect(placeReadOnlyCursor(view, 7)).toBe(true);
		expect(view.state.selection.main.empty).toBe(true);
		expect(view.state.selection.main.head).toBe(7);
		expect(view.state.doc.toString()).toBe(originalDocument);
		expect(view.hasFocus).toBe(false);

		expect(placeReadOnlyCursor(view, 2)).toBe(true);
		expect(view.state.selection.main.head).toBe(2);
		expect(placeReadOnlyCursor(view, 2)).toBe(true);
		expect(view.state.doc.toString()).toBe(originalDocument);
	});

	it("clamps cursor placement in an empty document and declines editable views", () => {
		const readOnly = createEditor(true, "").view;
		const editable = createEditor(false).view;

		expect(placeReadOnlyCursor(readOnly, 10)).toBe(true);
		expect(readOnly.state.selection.main.head).toBe(0);
		expect(readOnly.hasFocus).toBe(false);

		expect(placeReadOnlyCursor(editable, 5)).toBe(false);
		expect(editable.state.selection.main.head).toBe(0);
	});

	it("accepts only uncancelled short primary taps", () => {
		const start = {
			pointerId: 1,
			x: 10,
			y: 20,
			timeStamp: 100,
			isPrimary: true,
			button: 0,
		};
		const end = {
			pointerId: 1,
			x: 14,
			y: 24,
			timeStamp: 180,
			isPrimary: true,
			button: 0,
		};

		expect(shouldCommitReadOnlyTap(start, end)).toBe(true);
		expect(shouldCommitReadOnlyTap({ ...start, cancelled: true }, end)).toBe(
			false,
		);
		expect(shouldCommitReadOnlyTap(start, { ...end, x: 50 })).toBe(false);
		expect(shouldCommitReadOnlyTap(start, { ...end, timeStamp: 700 })).toBe(
			false,
		);
		expect(shouldCommitReadOnlyTap(start, { ...end, pointerId: 2 })).toBe(
			false,
		);
		expect(shouldCommitReadOnlyTap(start, { ...end, isPrimary: false })).toBe(
			false,
		);
	});

	it("resolves words and preserves an existing long-press selection", () => {
		let state = EditorState.create({
			doc: "alpha beta",
			selection: EditorSelection.range(0, 5),
		});
		let range = resolveReadOnlyContextSelection(state, 3);
		expect([range.from, range.to]).toEqual([0, 5]);

		state = EditorState.create({ doc: "alpha beta" });
		range = resolveReadOnlyContextSelection(state, 7);
		expect([range.from, range.to]).toEqual([6, 10]);
	});

	it("uses character and empty-document fallbacks for long-press", () => {
		let state = EditorState.create({ doc: "alpha + beta" });
		let range = resolveReadOnlyContextSelection(state, 6);
		expect(state.sliceDoc(range.from, range.to)).toBe("+");

		state = EditorState.create({ doc: "alpha 💡 beta" });
		range = resolveReadOnlyContextSelection(state, 6);
		expect(state.sliceDoc(range.from, range.to)).toBe("💡");

		state = EditorState.create({ doc: "" });
		range = resolveReadOnlyContextSelection(state, 0);
		expect(range.empty).toBe(true);
		expect(range.from).toBe(0);
	});
});

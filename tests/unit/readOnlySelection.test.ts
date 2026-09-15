// @vitest-environment happy-dom
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { createEditorReadOnlyExtension } from "cm/editorReadOnly";
import createTouchSelectionMenu from "cm/touchSelectionMenu";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("lib/selectionMenu", () => ({ default: [] }));
let view: EditorView;
let menu: ReturnType<typeof createTouchSelectionMenu>;
afterEach(() => {
	menu?.destroy();
	view?.destroy();
	document.body.replaceChildren();
	document.body.style.userSelect = "";
});
function create(readOnly = true) {
	document.body.style.userSelect = "none";
	view = new EditorView({
		parent: document.body,
		state: EditorState.create({
			doc: "select this text\nnext line",
			extensions: [createEditorReadOnlyExtension(readOnly)],
		}),
	});
	menu = createTouchSelectionMenu(view);
}
function selectText() {
	const text = view.contentDOM.querySelector(".cm-line")!.firstChild!;
	const selection = document.getSelection()!;
	selection.setBaseAndExtent(text, 0, text, 11);
	document.dispatchEvent(new Event("selectionchange"));
	return selection;
}

describe("native read-only selection", () => {
	it("overrides the app's non-selectable shell while staying non-editable", () => {
		create();
		expect(getComputedStyle(view.contentDOM).userSelect).toBe("text");
		expect(view.contentDOM.getAttribute("contenteditable")).toBe("false");
		expect(view.state.readOnly).toBe(true);
	});
	it("leaves long-press context selection and finger release to the browser", () => {
		create();
		const selection = selectText();
		const context = new MouseEvent("contextmenu", {
			bubbles: true,
			cancelable: true,
		});
		view.contentDOM.dispatchEvent(context);
		expect(context.defaultPrevented).toBe(false);
		view.contentDOM.dispatchEvent(
			new PointerEvent("pointerdown", {
				bubbles: true,
				pointerId: 1,
				isPrimary: true,
				button: 0,
			}),
		);
		view.contentDOM.dispatchEvent(
			new PointerEvent("pointerup", {
				bubbles: true,
				pointerId: 1,
				isPrimary: true,
				button: 0,
			}),
		);
		expect(selection.toString()).toBe("select this");
		expect(view.hasFocus).toBe(false);
		expect(menu.isMenuVisible()).toBe(false);
	});
	it("copies selected text while rejecting edit transactions", () => {
		create();
		selectText();
		const data = new DataTransfer();
		view.contentDOM.dispatchEvent(
			new ClipboardEvent("copy", {
				bubbles: true,
				cancelable: true,
				clipboardData: data,
			}),
		);
		expect(data.getData("text/plain")).toBe("select this");
		view.dispatch({
			changes: { from: 0, to: 11, insert: "changed" },
			userEvent: "input.type",
		});
		expect(view.state.doc.toString()).toBe("select this text\nnext line");
	});
	it("retains the app's custom context menu for editable text", () => {
		create(false);
		const context = new MouseEvent("contextmenu", {
			bubbles: true,
			cancelable: true,
		});
		view.contentDOM.dispatchEvent(context);
		expect(context.defaultPrevented).toBe(true);
	});
});

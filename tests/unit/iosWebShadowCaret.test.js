import fs from "node:fs";
import { Window } from "happy-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const source = fs.readFileSync(
	new URL("../../platforms/ios/runner/WebShadowCaret.swift", import.meta.url),
	"utf8",
);
const script = source.match(/static let script = """\n([\s\S]*?)\n\s*"""/)[1];
let window, nativeAddRange, setBaseAndExtent;

beforeEach(() => {
	window = new Window();
	nativeAddRange = vi
		.spyOn(window.Selection.prototype, "addRange")
		.mockImplementation(() => {});
	setBaseAndExtent = vi.spyOn(window.Selection.prototype, "setBaseAndExtent");
	window.eval(script);
});
afterEach(async () => {
	await window.happyDOM.close();
	vi.restoreAllMocks();
});

it("restores a rejected caret inside a focused shadow editor", () => {
	const { editor, range, selection } = fixture();
	selection.addRange(range);
	expect(nativeAddRange).toHaveBeenCalledExactlyOnceWith(range);
	expect(setBaseAndExtent).toHaveBeenCalledExactlyOnceWith(
		editor,
		0,
		editor,
		0,
	);
	expect(selection.rangeCount).toBe(1);
});

it("keeps successful native selection unchanged and installs only once", () => {
	const { range, selection } = fixture();
	const installed = window.Selection.prototype.addRange;
	window.eval(script);
	expect(window.Selection.prototype.addRange).toBe(installed);
	nativeAddRange.mockImplementation(function (value) {
		this.setBaseAndExtent(value.startContainer, 0, value.endContainer, 0);
	});
	selection.addRange(range);
	expect(setBaseAndExtent).toHaveBeenCalledOnce();
});

it.each([
	"unfocused",
	"detached",
	"light DOM",
	"noncollapsed",
])("does not retarget a rejected %s selection", (reason) => {
	const { editor, range, selection } = fixture();
	if (reason === "unfocused") {
		const input = window.document.createElement("input");
		window.document.body.append(input);
		input.focus();
	}
	if (reason === "detached") editor.getRootNode().host.remove();
	if (reason === "light DOM") window.document.body.append(editor);
	if (reason === "noncollapsed") {
		editor.textContent = "xy";
		range.selectNodeContents(editor);
	}
	selection.addRange(range);
	expect(setBaseAndExtent).not.toHaveBeenCalled();
	expect(selection.rangeCount).toBe(0);
});

function fixture() {
	const host = window.document.createElement("div");
	window.document.body.append(host);
	const shadow = host.attachShadow({ mode: "open" });
	const editor = window.document.createElement("div");
	editor.contentEditable = "true";
	shadow.append(editor);
	editor.focus();
	const range = window.document.createRange();
	range.setStart(editor, 0);
	range.collapse(true);
	const selection = window.document.getSelection();
	return { editor, range, selection };
}

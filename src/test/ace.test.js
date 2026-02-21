import { TestRunner } from "./tester";

/**
 * Ace Editor API Compatibility Tests
 *
 * These tests validate that the CodeMirror-based editor (from editorManager)
 * properly implements the Ace Editor API compatibility layer.
 */
export async function runAceCompatibilityTests(writeOutput) {
	const runner = new TestRunner("Ace API Compatibility");

	function getEditor() {
		return editorManager?.editor;
	}

	async function createTestFile(text = "") {
		const EditorFile = acode.require("editorFile");
		const file = new EditorFile("__ace_test__.txt", {
			text,
			render: true,
		});
		await new Promise((r) => setTimeout(r, 100));
		return file;
	}

	runner.test("editorManager.editor exists", (test) => {
		test.assert(
			typeof editorManager !== "undefined",
			"editorManager should exist",
		);
		test.assert(
			editorManager.editor != null,
			"editorManager.editor should exist",
		);
	});

	runner.test("editorManager isCodeMirror flag", (test) => {
		test.assertEqual(editorManager.isCodeMirror, true);
	});

	runner.test("editor.getValue()", (test) => {
		const editor = getEditor();
		test.assert(
			typeof editor.getValue === "function",
			"getValue should be a function",
		);
		const value = editor.getValue();
		test.assert(typeof value === "string", "getValue should return string");
	});

	runner.test("editor.insert()", (test) => {
		const editor = getEditor();
		test.assert(
			typeof editor.insert === "function",
			"insert should be a function",
		);
	});

	runner.test("editor.getCursorPosition()", (test) => {
		const editor = getEditor();
		test.assert(
			typeof editor.getCursorPosition === "function",
			"getCursorPosition should exist",
		);
		const pos = editor.getCursorPosition();
		test.assert(typeof pos.row === "number", "row should be number");
		test.assert(typeof pos.column === "number", "column should be number");
	});

	runner.test("editor.gotoLine()", (test) => {
		const editor = getEditor();
		test.assert(
			typeof editor.gotoLine === "function",
			"gotoLine should be a function",
		);
	});

	runner.test("editor.moveCursorToPosition()", (test) => {
		const editor = getEditor();
		test.assert(
			typeof editor.moveCursorToPosition === "function",
			"moveCursorToPosition should exist",
		);
	});

	runner.test("editor.selection object", (test) => {
		const editor = getEditor();
		test.assert(editor.selection != null, "selection should exist");
	});

	runner.test("editor.selection.getRange()", (test) => {
		const editor = getEditor();
		test.assert(
			typeof editor.selection.getRange === "function",
			"getRange should be a function",
		);
		const range = editor.selection.getRange();
		test.assert(range.start != null, "range should have start");
		test.assert(range.end != null, "range should have end");
	});

	runner.test("editor.selection.getCursor()", (test) => {
		const editor = getEditor();
		test.assert(
			typeof editor.selection.getCursor === "function",
			"getCursor should be a function",
		);
		const pos = editor.selection.getCursor();
		test.assert(typeof pos.row === "number", "row should be number");
		test.assert(typeof pos.column === "number", "column should be number");
	});

	runner.test("editor.getCopyText()", (test) => {
		const editor = getEditor();
		test.assert(
			typeof editor.getCopyText === "function",
			"getCopyText should exist",
		);
		const text = editor.getCopyText();
		test.assert(typeof text === "string", "should return string");
	});

	runner.test("editor.session exists", async (test) => {
		const testFile = await createTestFile("test");
		const editor = getEditor();
		test.assert(editor.session != null, "session should exist");
		testFile.remove(false);
	});

	runner.test("editor.setTheme()", (test) => {
		const editor = getEditor();
		test.assert(
			typeof editor.setTheme === "function",
			"setTheme should be a function",
		);
	});

	runner.test("editor.commands object", (test) => {
		const editor = getEditor();
		test.assert(editor.commands != null, "commands should exist");
	});

	runner.test("editor.commands.addCommand()", (test) => {
		const editor = getEditor();
		test.assert(
			typeof editor.commands.addCommand === "function",
			"addCommand should be a function",
		);
	});

	runner.test("editor.commands.removeCommand()", (test) => {
		const editor = getEditor();
		test.assert(
			typeof editor.commands.removeCommand === "function",
			"removeCommand should exist",
		);
	});

	runner.test("editor.commands.commands getter", (test) => {
		const editor = getEditor();
		const cmds = editor.commands.commands;
		test.assert(
			typeof cmds === "object" && cmds !== null,
			"commands should return object",
		);
	});

	runner.test("editor.execCommand()", (test) => {
		const editor = getEditor();
		test.assert(
			typeof editor.execCommand === "function",
			"execCommand should be a function",
		);
	});

	runner.test("editor.focus()", (test) => {
		const editor = getEditor();
		test.assert(
			typeof editor.focus === "function",
			"focus should be a function",
		);
	});

	runner.test("editor.state (CodeMirror)", (test) => {
		const editor = getEditor();
		test.assert(editor.state != null, "state should exist");
	});

	runner.test("editor.dispatch (CodeMirror)", (test) => {
		const editor = getEditor();
		test.assert(
			typeof editor.dispatch === "function",
			"dispatch should be a function",
		);
	});

	runner.test("editor.contentDOM (CodeMirror)", (test) => {
		const editor = getEditor();
		test.assert(editor.contentDOM != null, "contentDOM should exist");
	});

	// Session API tests

	runner.test("session.getValue()", async (test) => {
		const testFile = await createTestFile("test content");
		const editor = getEditor();
		test.assert(
			typeof editor.session.getValue === "function",
			"getValue should exist",
		);
		const value = editor.session.getValue();
		test.assert(typeof value === "string", "should return string");
		test.assertEqual(value, "test content");
		testFile.remove(false);
	});

	runner.test("session.setValue()", async (test) => {
		const testFile = await createTestFile("original");
		const editor = getEditor();
		test.assert(
			typeof editor.session.setValue === "function",
			"setValue should exist",
		);
		editor.session.setValue("modified");
		test.assertEqual(editor.session.getValue(), "modified");
		testFile.remove(false);
	});

	runner.test("session.getLength()", async (test) => {
		const testFile = await createTestFile("line1\nline2\nline3");
		const editor = getEditor();
		test.assert(
			typeof editor.session.getLength === "function",
			"getLength should exist",
		);
		const len = editor.session.getLength();
		test.assert(typeof len === "number", "should return number");
		test.assertEqual(len, 3);
		testFile.remove(false);
	});

	runner.test("session.getLine()", async (test) => {
		const testFile = await createTestFile("first\nsecond\nthird");
		const editor = getEditor();
		test.assert(
			typeof editor.session.getLine === "function",
			"getLine should exist",
		);
		test.assertEqual(editor.session.getLine(0), "first");
		test.assertEqual(editor.session.getLine(1), "second");
		test.assertEqual(editor.session.getLine(2), "third");
		testFile.remove(false);
	});

	return await runner.run(writeOutput);
}

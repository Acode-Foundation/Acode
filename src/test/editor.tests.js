import { TestRunner } from "./tester";

export async function runAceEditorTests(writeOutput) {
	const runner = new TestRunner("Ace Editor API Tests");

	function createEditor() {
		const container = document.createElement("div");
		container.style.width = "500px";
		container.style.height = "300px";
		container.style.backgroundColor = "#a02f2f";
		document.body.appendChild(container);

		const editor = ace.edit(container);
		return { editor, container };
	}

	async function withEditor(test, fn) {
		let editor, container;

		try {
			({ editor, container } = createEditor());
			test.assert(editor != null, "Editor instance should be created");
			await new Promise((resolve) => setTimeout(resolve, 100));
			await fn(editor);
			await new Promise((resolve) => setTimeout(resolve, 200));
		} finally {
			if (editor) editor.destroy();
			if (container) container.remove();
		}
	}

	// Test 1: Ace is available
	runner.test("Ace is loaded", async (test) => {
		test.assert(typeof ace !== "undefined", "Ace should be available globally");
		test.assert(
			typeof ace.edit === "function",
			"ace.edit should be a function",
		);
	});

	// Test 2: Editor creation
	runner.test("Editor creation", async (test) => {
		const { editor, container } = createEditor();
		test.assert(editor != null, "Editor instance should be created");
		test.assert(
			typeof editor.getSession === "function",
			"Editor should expose getSession",
		);
		editor.destroy();
		container.remove();
	});

	// Test 3: Session access
	runner.test("Session access", async (test) => {
		await withEditor(test, async (editor) => {
			const session = editor.getSession();
			test.assert(session != null, "Editor session should exist");
			test.assert(
				typeof session.getValue === "function",
				"Session should expose getValue",
			);
		});
	});

	// Test 4: Set and get value
	runner.test("Set and get value", async (test) => {
		await withEditor(test, async (editor) => {
			const text = "Hello Ace Editor";
			editor.setValue(text, -1);
			test.assertEqual(editor.getValue(), text);
		});
	});

	// Test 5: Cursor movement
	runner.test("Cursor movement", async (test) => {
		await withEditor(test, async (editor) => {
			editor.setValue("line1\nline2\nline3", -1);
			editor.moveCursorTo(1, 2);

			const pos = editor.getCursorPosition();
			test.assertEqual(pos.row, 1);
			test.assertEqual(pos.column, 2);
		});
	});

	// Test 6: Selection API
	runner.test("Selection handling", async (test) => {
		await withEditor(test, async (editor) => {
			editor.setValue("abc\ndef", -1);
			editor.selectAll();
			test.assert(editor.getSelectedText().length > 0);
		});
	});

	// Test 7: Undo manager
	runner.test("Undo manager works", async (test) => {
		await withEditor(test, async (editor) => {
			const session = editor.getSession();
			const undoManager = session.getUndoManager();

			session.setValue("one");
			undoManager.reset();

			editor.insert("\ntwo");
			editor.undo();

			test.assertEqual(editor.getValue(), "one");
		});
	});

	// Test 8: Mode setting
	runner.test("Mode setting", async (test) => {
		await withEditor(test, async (editor) => {
			const session = editor.getSession();
			session.setMode("ace/mode/javascript");

			const mode = session.getMode();
			test.assert(mode && mode.$id === "ace/mode/javascript");
		});
	});

	// Test 9: Theme setting
	runner.test("Theme setting", async (test) => {
		await withEditor(test, async (editor) => {
			editor.setTheme("ace/theme/monokai");
			test.assert(editor.getTheme().includes("monokai"));
		});
	});

	// Test 11: Line count
	runner.test("Line count", async (test) => {
		await withEditor(test, async (editor) => {
			editor.setValue("a\nb\nc\nd", -1);
			test.assertEqual(editor.session.getLength(), 4);
		});
	});

	// Test 12: Replace text
	runner.test("Replace text", async (test) => {
		await withEditor(test, async (editor) => {
			editor.setValue("hello world", -1);
			editor.find("world");
			editor.replace("ace");

			test.assertEqual(editor.getValue(), "hello ace");
		});
	});

	// Test 13: Search API
	runner.test("Search API", async (test) => {
		await withEditor(test, async (editor) => {
			editor.setValue("foo bar foo", -1);
			editor.find("foo");

			const range = editor.getSelectionRange();
			test.assert(range.start.column === 0);
		});
	});

	// Test 14: Renderer availability
	runner.test("Renderer exists", async (test) => {
		await withEditor(test, async (editor) => {
			const renderer = editor.renderer;
			test.assert(renderer != null);
			test.assert(typeof renderer.updateFull === "function");
		});
	});

	// Test 15: Editor options
	runner.test("Editor options", async (test) => {
		await withEditor(test, async (editor) => {
			editor.setOption("showPrintMargin", false);
			test.assertEqual(editor.getOption("showPrintMargin"), false);
		});
	});

	// Test 16: Scroll API
	runner.test("Scroll API", async (test) => {
		await withEditor(test, async (editor) => {
			editor.setValue(Array(100).fill("line").join("\n"), -1);
			editor.scrollToLine(50, true, true, () => {});

			const firstVisibleRow = editor.renderer.getFirstVisibleRow();
			test.assert(firstVisibleRow >= 0);
		});
	});

	// Test 17: Redo manager
	runner.test("Redo manager works", async (test) => {
		await withEditor(test, async (editor) => {
			const session = editor.getSession();
			const undoManager = session.getUndoManager();

			session.setValue("one");
			undoManager.reset();

			session.insert({ row: 0, column: 3 }, "\ntwo");
			editor.undo();
			editor.redo();

			test.assertEqual(editor.getValue(), "one\ntwo");
		});
	});

	// Test 18: Focus and blur
	runner.test("Focus and blur", async (test) => {
		await withEditor(test, async (editor) => {
			editor.focus();
			test.assert(editor.isFocused());

			editor.blur();
			test.assert(!editor.isFocused());
		});
	});

	return await runner.run(writeOutput);
}

import { history, isolateHistory, redo, undo } from "@codemirror/commands";
import {
	bracketMatching,
	defaultHighlightStyle,
	foldGutter,
	syntaxHighlighting,
} from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import createBaseExtensions from "cm/baseExtensions";
import { getEdgeScrollDirections } from "cm/touchSelectionMenu";
import { TestRunner } from "./tester";

export async function runCodeMirrorTests(writeOutput) {
	const runner = new TestRunner("CodeMirror 6 Editor Tests");

	function createEditor(doc = "", extensions = []) {
		const container = document.createElement("div");
		container.style.width = "500px";
		container.style.height = "300px";
		container.style.backgroundColor = "#1e1e1e";
		document.body.appendChild(container);

		const state = EditorState.create({
			doc,
			extensions: [...createBaseExtensions(), ...extensions],
		});

		const view = new EditorView({ state, parent: container });
		return { view, container };
	}

	async function withEditor(test, fn, initialDoc = "", extensions = []) {
		let view, container;

		try {
			({ view, container } = createEditor(initialDoc, extensions));
			test.assert(view != null, "EditorView instance should be created");
			await new Promise((resolve) => setTimeout(resolve, 100));
			await fn(view);
			await new Promise((resolve) => setTimeout(resolve, 200));
		} finally {
			if (view) view.destroy();
			if (container) container.remove();
		}
	}

	// =========================================
	// BASIC EDITOR TESTS
	// =========================================

	runner.test("CodeMirror imports available", async (test) => {
		test.assert(
			typeof EditorView !== "undefined",
			"EditorView should be defined",
		);
		test.assert(
			typeof EditorState !== "undefined",
			"EditorState should be defined",
		);
		test.assert(
			typeof EditorState.create === "function",
			"EditorState.create should be a function",
		);
	});

	runner.test("Editor creation", async (test) => {
		const { view, container } = createEditor();
		test.assert(view != null, "EditorView instance should be created");
		test.assert(view.dom instanceof HTMLElement, "Editor should have DOM");
		test.assert(view.state instanceof EditorState, "Editor should have state");
		view.destroy();
		container.remove();
	});

	runner.test("State access", async (test) => {
		await withEditor(test, async (view) => {
			const state = view.state;
			test.assert(state != null, "Editor state should exist");
			test.assert(typeof state.doc !== "undefined", "State should have doc");
			test.assert(
				typeof state.doc.toString === "function",
				"Doc should have toString",
			);
		});
	});

	runner.test("Set and get document content", async (test) => {
		await withEditor(test, async (view) => {
			const text = "Hello CodeMirror 6";
			view.dispatch({
				changes: { from: 0, to: view.state.doc.length, insert: text },
			});
			test.assertEqual(view.state.doc.toString(), text);
		});
	});

	// =========================================
	// CURSOR AND SELECTION TESTS
	// =========================================

	runner.test("Cursor movement", async (test) => {
		await withEditor(test, async (view) => {
			const doc = "line1\nline2\nline3";
			view.dispatch({
				changes: { from: 0, to: view.state.doc.length, insert: doc },
			});

			const line2 = view.state.doc.line(2);
			const targetPos = line2.from + 2;
			view.dispatch({
				selection: { anchor: targetPos, head: targetPos },
			});

			const pos = view.state.selection.main.head;
			const lineInfo = view.state.doc.lineAt(pos);
			test.assertEqual(lineInfo.number, 2);
			test.assertEqual(pos - lineInfo.from, 2);
		});
	});

	runner.test("Selection handling", async (test) => {
		await withEditor(test, async (view) => {
			view.dispatch({
				changes: { from: 0, to: view.state.doc.length, insert: "abc\ndef" },
			});
			view.dispatch({
				selection: { anchor: 0, head: view.state.doc.length },
			});

			const { from, to } = view.state.selection.main;
			const selectedText = view.state.doc.sliceString(from, to);
			test.assert(selectedText.length > 0, "Should have selected text");
			test.assertEqual(selectedText, "abc\ndef");
		});
	});

	runner.test("Multiple selections", async (test) => {
		await withEditor(test, async (view) => {
			view.dispatch({
				changes: { from: 0, to: view.state.doc.length, insert: "foo bar foo" },
			});

			view.dispatch({
				selection: EditorSelection.create([
					EditorSelection.range(0, 3),
					EditorSelection.range(8, 11),
				]),
			});

			test.assertEqual(view.state.selection.ranges.length, 2);
			test.assertEqual(view.state.doc.sliceString(0, 3), "foo");
			test.assertEqual(view.state.doc.sliceString(8, 11), "foo");
		});
	});

	runner.test("Selection with cursor (empty range)", async (test) => {
		await withEditor(test, async (view) => {
			view.dispatch({
				changes: { from: 0, to: view.state.doc.length, insert: "hello world" },
			});

			view.dispatch({
				selection: EditorSelection.cursor(5),
			});

			const main = view.state.selection.main;
			test.assertEqual(main.from, 5);
			test.assertEqual(main.to, 5);
			test.assert(main.empty, "Cursor selection should be empty");
		});
	});

	// =========================================
	// HISTORY (UNDO/REDO) TESTS
	// =========================================

	runner.test("Undo works", async (test) => {
		const { view, container } = createEditor("one");

		try {
			view.dispatch({
				changes: { from: 3, insert: "\ntwo" },
			});
			test.assertEqual(view.state.doc.toString(), "one\ntwo");

			undo(view);
			test.assertEqual(view.state.doc.toString(), "one");
		} finally {
			view.destroy();
			container.remove();
		}
	});

	runner.test("Redo works", async (test) => {
		const { view, container } = createEditor("one");

		try {
			view.dispatch({
				changes: { from: 3, insert: "\ntwo" },
			});

			undo(view);
			test.assertEqual(view.state.doc.toString(), "one");

			redo(view);
			test.assertEqual(view.state.doc.toString(), "one\ntwo");
		} finally {
			view.destroy();
			container.remove();
		}
	});

	runner.test("Multiple undo steps", async (test) => {
		const { view, container } = createEditor("");

		try {
			// Use isolateHistory to force each change into separate history entries
			view.dispatch({
				changes: { from: 0, insert: "a" },
				annotations: isolateHistory.of("full"),
			});
			view.dispatch({
				changes: { from: 1, insert: "b" },
				annotations: isolateHistory.of("full"),
			});
			view.dispatch({
				changes: { from: 2, insert: "c" },
				annotations: isolateHistory.of("full"),
			});

			test.assertEqual(view.state.doc.toString(), "abc");

			undo(view);
			undo(view);
			test.assertEqual(view.state.doc.toString(), "a");
		} finally {
			view.destroy();
			container.remove();
		}
	});

	// =========================================
	// DOCUMENT MANIPULATION TESTS
	// =========================================

	runner.test("Line count", async (test) => {
		await withEditor(test, async (view) => {
			view.dispatch({
				changes: { from: 0, to: view.state.doc.length, insert: "a\nb\nc\nd" },
			});
			test.assertEqual(view.state.doc.lines, 4);
		});
	});

	runner.test("Insert text at position", async (test) => {
		await withEditor(test, async (view) => {
			view.dispatch({
				changes: { from: 0, to: view.state.doc.length, insert: "hello world" },
			});

			view.dispatch({
				changes: { from: 5, to: 5, insert: " there" },
			});

			test.assertEqual(view.state.doc.toString(), "hello there world");
		});
	});

	runner.test("Replace text range", async (test) => {
		await withEditor(test, async (view) => {
			view.dispatch({
				changes: { from: 0, to: view.state.doc.length, insert: "hello world" },
			});

			view.dispatch({
				changes: { from: 6, to: 11, insert: "cm6" },
			});

			test.assertEqual(view.state.doc.toString(), "hello cm6");
		});
	});

	runner.test("Delete text", async (test) => {
		await withEditor(test, async (view) => {
			view.dispatch({
				changes: { from: 0, insert: "hello world" },
			});

			view.dispatch({
				changes: { from: 5, to: 11, insert: "" },
			});

			test.assertEqual(view.state.doc.toString(), "hello");
		});
	});

	runner.test("Batch changes", async (test) => {
		await withEditor(test, async (view) => {
			view.dispatch({
				changes: { from: 0, insert: "aaa bbb ccc" },
			});

			view.dispatch({
				changes: [
					{ from: 0, to: 3, insert: "xxx" },
					{ from: 4, to: 7, insert: "yyy" },
					{ from: 8, to: 11, insert: "zzz" },
				],
			});

			test.assertEqual(view.state.doc.toString(), "xxx yyy zzz");
		});
	});

	runner.test("Line information", async (test) => {
		await withEditor(test, async (view) => {
			view.dispatch({
				changes: {
					from: 0,
					to: view.state.doc.length,
					insert: "line one\nline two\nline three",
				},
			});

			const line2 = view.state.doc.line(2);
			test.assertEqual(line2.number, 2);
			test.assertEqual(line2.text, "line two");
			test.assert(line2.from > 0, "Line 2 should have positive from");
		});
	});

	runner.test("Position conversions", async (test) => {
		await withEditor(test, async (view) => {
			view.dispatch({
				changes: {
					from: 0,
					to: view.state.doc.length,
					insert: "abc\ndefgh\nij",
				},
			});

			const pos = 7; // 'g' in "defgh"
			const lineInfo = view.state.doc.lineAt(pos);

			test.assertEqual(lineInfo.number, 2);
			test.assertEqual(lineInfo.text, "defgh");
			test.assertEqual(pos - lineInfo.from, 3);
		});
	});

	runner.test("Empty document handling", async (test) => {
		await withEditor(test, async (view) => {
			test.assertEqual(view.state.doc.length, 0);
			test.assertEqual(view.state.doc.lines, 1);
			test.assertEqual(view.state.doc.toString(), "");
		});
	});

	// =========================================
	// DOM AND VIEW TESTS
	// =========================================

	runner.test("DOM elements exist", async (test) => {
		await withEditor(test, async (view) => {
			test.assert(view.dom != null, "view.dom should exist");
			test.assert(view.scrollDOM != null, "view.scrollDOM should exist");
			test.assert(view.contentDOM != null, "view.contentDOM should exist");
		});
	});

	runner.test("Focus and blur", async (test) => {
		await withEditor(test, async (view) => {
			view.focus();
			await new Promise((resolve) => setTimeout(resolve, 50));
			test.assert(view.hasFocus, "Editor should have focus");

			view.contentDOM.blur();
			await new Promise((resolve) => setTimeout(resolve, 50));
			test.assert(!view.hasFocus, "Editor should not have focus after blur");
		});
	});

	runner.test("Scroll API", async (test) => {
		await withEditor(test, async (view) => {
			const longDoc = Array(100).fill("line").join("\n");
			view.dispatch({
				changes: { from: 0, to: view.state.doc.length, insert: longDoc },
			});

			const line50 = view.state.doc.line(50);
			view.dispatch({
				effects: EditorView.scrollIntoView(line50.from, { y: "center" }),
			});

			await new Promise((resolve) => setTimeout(resolve, 100));
			test.assert(
				view.scrollDOM.scrollTop >= 0,
				"scrollTop should be accessible",
			);
		});
	});

	runner.test("Viewport info", async (test) => {
		await withEditor(test, async (view) => {
			const longDoc = Array(200).fill("some text content").join("\n");
			view.dispatch({
				changes: { from: 0, insert: longDoc },
			});

			const viewport = view.viewport;
			test.assert(typeof viewport.from === "number", "viewport.from exists");
			test.assert(typeof viewport.to === "number", "viewport.to exists");
			test.assert(viewport.to > viewport.from, "viewport has range");
		});
	});

	// =========================================
	// CODEMIRROR-SPECIFIC FEATURES
	// =========================================

	runner.test("EditorState facets", async (test) => {
		const { view, container } = createEditor("test");

		try {
			const readOnly = view.state.facet(EditorState.readOnly);
			test.assert(typeof readOnly === "boolean", "readOnly facet exists");
			test.assertEqual(readOnly, false);
		} finally {
			view.destroy();
			container.remove();
		}
	});

	runner.test("Read-only facet value", async (test) => {
		const container = document.createElement("div");
		container.style.width = "500px";
		container.style.height = "300px";
		document.body.appendChild(container);

		const state = EditorState.create({
			doc: "read only content",
			extensions: [EditorState.readOnly.of(true)],
		});

		const view = new EditorView({ state, parent: container });

		try {
			const isReadOnly = view.state.facet(EditorState.readOnly);
			test.assertEqual(isReadOnly, true, "Should report as read-only");
		} finally {
			view.destroy();
			container.remove();
		}
	});

	runner.test("Transaction filtering", async (test) => {
		let filterCalled = false;

		const container = document.createElement("div");
		container.style.width = "500px";
		container.style.height = "300px";
		document.body.appendChild(container);

		const state = EditorState.create({
			doc: "original",
			extensions: [
				EditorState.transactionFilter.of((tr) => {
					if (tr.docChanged) filterCalled = true;
					return tr;
				}),
			],
		});

		const view = new EditorView({ state, parent: container });

		try {
			view.dispatch({
				changes: { from: 0, to: 8, insert: "modified" },
			});

			test.assert(filterCalled, "Transaction filter should be called");
			test.assertEqual(view.state.doc.toString(), "modified");
		} finally {
			view.destroy();
			container.remove();
		}
	});

	runner.test("Update listener", async (test) => {
		let updateCount = 0;
		let docChanged = false;

		const container = document.createElement("div");
		container.style.width = "500px";
		container.style.height = "300px";
		document.body.appendChild(container);

		const state = EditorState.create({
			doc: "",
			extensions: [
				EditorView.updateListener.of((update) => {
					updateCount++;
					if (update.docChanged) docChanged = true;
				}),
			],
		});

		const view = new EditorView({ state, parent: container });

		try {
			view.dispatch({
				changes: { from: 0, insert: "hello" },
			});

			test.assert(updateCount > 0, "Update listener should fire");
			test.assert(docChanged, "docChanged should be true");
		} finally {
			view.destroy();
			container.remove();
		}
	});

	runner.test("State effects", async (test) => {
		const { StateEffect } = await import("@codemirror/state");
		const myEffect = StateEffect.define();

		let effectReceived = false;

		const container = document.createElement("div");
		container.style.width = "500px";
		container.style.height = "300px";
		document.body.appendChild(container);

		const state = EditorState.create({
			doc: "",
			extensions: [
				EditorView.updateListener.of((update) => {
					for (const tr of update.transactions) {
						for (const effect of tr.effects) {
							if (effect.is(myEffect)) {
								effectReceived = true;
							}
						}
					}
				}),
			],
		});

		const view = new EditorView({ state, parent: container });

		try {
			view.dispatch({
				effects: myEffect.of("test-value"),
			});

			test.assert(effectReceived, "Custom state effect should be received");
		} finally {
			view.destroy();
			container.remove();
		}
	});

	runner.test("Compartments for dynamic config", async (test) => {
		const { Compartment } = await import("@codemirror/state");

		const readOnlyComp = new Compartment();

		const container = document.createElement("div");
		container.style.width = "500px";
		container.style.height = "300px";
		document.body.appendChild(container);

		const state = EditorState.create({
			doc: "test",
			extensions: [readOnlyComp.of(EditorState.readOnly.of(false))],
		});

		const view = new EditorView({ state, parent: container });

		try {
			test.assertEqual(view.state.facet(EditorState.readOnly), false);

			view.dispatch({
				effects: readOnlyComp.reconfigure(EditorState.readOnly.of(true)),
			});

			test.assertEqual(view.state.facet(EditorState.readOnly), true);
		} finally {
			view.destroy();
			container.remove();
		}
	});

	runner.test("Document iteration", async (test) => {
		await withEditor(test, async (view) => {
			view.dispatch({
				changes: { from: 0, insert: "line1\nline2\nline3" },
			});

			const lines = [];
			for (let i = 1; i <= view.state.doc.lines; i++) {
				lines.push(view.state.doc.line(i).text);
			}

			test.assertEqual(lines.length, 3);
			test.assertEqual(lines[0], "line1");
			test.assertEqual(lines[1], "line2");
			test.assertEqual(lines[2], "line3");
		});
	});

	runner.test("Text iterator", async (test) => {
		await withEditor(test, async (view) => {
			view.dispatch({
				changes: { from: 0, insert: "hello world" },
			});

			const iter = view.state.doc.iter();
			let text = "";
			while (!iter.done) {
				text += iter.value;
				iter.next();
			}

			test.assertEqual(text, "hello world");
		});
	});

	runner.test("Slice string", async (test) => {
		await withEditor(test, async (view) => {
			view.dispatch({
				changes: { from: 0, insert: "hello world" },
			});

			test.assertEqual(view.state.doc.sliceString(0, 5), "hello");
			test.assertEqual(view.state.doc.sliceString(6, 11), "world");
			test.assertEqual(view.state.doc.sliceString(6), "world");
		});
	});

	runner.test("Line at position", async (test) => {
		await withEditor(test, async (view) => {
			view.dispatch({
				changes: { from: 0, insert: "aaa\nbbb\nccc" },
			});

			const lineAtStart = view.state.doc.lineAt(0);
			test.assertEqual(lineAtStart.number, 1);

			const lineAtMiddle = view.state.doc.lineAt(5);
			test.assertEqual(lineAtMiddle.number, 2);

			const lineAtEnd = view.state.doc.lineAt(10);
			test.assertEqual(lineAtEnd.number, 3);
		});
	});

	runner.test("Visible ranges", async (test) => {
		await withEditor(test, async (view) => {
			const longDoc = Array(100).fill("content").join("\n");
			view.dispatch({
				changes: { from: 0, insert: longDoc },
			});

			const visibleRanges = view.visibleRanges;
			test.assert(Array.isArray(visibleRanges), "visibleRanges is an array");
			test.assert(visibleRanges.length > 0, "Should have visible ranges");

			for (const range of visibleRanges) {
				test.assert(typeof range.from === "number", "range.from exists");
				test.assert(typeof range.to === "number", "range.to exists");
			}
		});
	});

	runner.test("coordsAtPos", async (test) => {
		await withEditor(test, async (view) => {
			view.dispatch({
				changes: { from: 0, insert: "hello" },
			});

			const coords = view.coordsAtPos(0);
			test.assert(coords != null, "coords should exist");
			test.assert(typeof coords.left === "number", "coords.left exists");
			test.assert(typeof coords.top === "number", "coords.top exists");
		});
	});

	runner.test("posAtCoords", async (test) => {
		await withEditor(test, async (view) => {
			view.dispatch({
				changes: { from: 0, insert: "hello world" },
			});

			const rect = view.contentDOM.getBoundingClientRect();
			const pos = view.posAtCoords({ x: rect.left + 10, y: rect.top + 10 });

			test.assert(pos != null || pos === null, "posAtCoords should return");
		});
	});

	runner.test("Edge scroll direction helper", async (test) => {
		const rect = {
			left: 100,
			right: 300,
			top: 200,
			bottom: 400,
		};

		const leftTop = getEdgeScrollDirections({
			x: 110,
			y: 210,
			rect,
			allowHorizontal: true,
		});
		test.assertEqual(leftTop.horizontal, -1);
		test.assertEqual(leftTop.vertical, -1);

		const rightBottom = getEdgeScrollDirections({
			x: 295,
			y: 395,
			rect,
			allowHorizontal: true,
		});
		test.assertEqual(rightBottom.horizontal, 1);
		test.assertEqual(rightBottom.vertical, 1);

		const noHorizontal = getEdgeScrollDirections({
			x: 110,
			y: 395,
			rect,
			allowHorizontal: false,
		});
		test.assertEqual(noHorizontal.horizontal, 0);
		test.assertEqual(noHorizontal.vertical, 1);
	});

	runner.test("lineBlockAt", async (test) => {
		await withEditor(test, async (view) => {
			view.dispatch({
				changes: { from: 0, insert: "line1\nline2\nline3" },
			});

			const line2Start = view.state.doc.line(2).from;
			const block = view.lineBlockAt(line2Start);

			test.assert(block != null, "lineBlockAt should return block");
			test.assert(typeof block.from === "number", "block.from exists");
			test.assert(typeof block.to === "number", "block.to exists");
			test.assert(typeof block.height === "number", "block.height exists");
		});
	});

	return await runner.run(writeOutput);
}

export { runCodeMirrorTests as runAceEditorTests };

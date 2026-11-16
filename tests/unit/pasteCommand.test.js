import * as cmState from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { loadSourceModule } from "../helpers/loadSourceModule";

const { EditorSelection, EditorState } = cmState;

const CRLF_TEXT = "print('a')\r\nprint('b')";
const PASTED = "print('a')\nprint('b')";

// Load the real command registry with the clipboard stubbed to return `text`.
function loadRegistry(text) {
	const dependencies = Object.fromEntries(
		[
			"fileSystem",
			"@codemirror/commands",
			"@codemirror/language",
			"@codemirror/lint",
			"@codemirror/lsp-client",
			"@codemirror/view",
			"cm/editorReadOnly",
			"cm/foldAwareLineCommands",
			"cm/foldingCommands",
			"cm/lsp",
			"cm/lsp/references",
			"components/symbolsPanel",
			"components/toast",
			"dialogs/prompt",
			"handlers/quickTools",
			"lib/settings",
			"utils/Url",
		].map((id) => [id, {}]),
	);
	return loadSourceModule(
		"src/cm/commandRegistry.js",
		{
			...dependencies,
			"@codemirror/state": cmState,
			"cm/keyBindingUtils": { toCodeMirrorKey: () => null },
			"lib/keyBindings": {
				__esModule: true,
				default: {},
				APP_KEY_BINDING_NAMES: new Set(),
				CODEMIRROR_COMMAND_NAMES: new Set(),
			},
		},
		{
			editorManager: null,
			cordova: { plugins: { clipboard: { paste: (done) => done(text) } } },
		},
	);
}

function createView(doc, selection) {
	let state = EditorState.create({
		doc,
		selection,
		extensions: EditorState.allowMultipleSelections.of(true),
	});
	return {
		get state() {
			return state;
		},
		dispatch(...specs) {
			state = state.update(...specs).state;
		},
	};
}

function paste(view, text = CRLF_TEXT) {
	const { executeCommand } = loadRegistry(text);
	expect(executeCommand("paste", view)).toBe(true);
	return view.state;
}

describe("paste command with CRLF clipboard text", () => {
	it("pastes into an empty document and leaves the cursor at the end", () => {
		const state = paste(createView(""));
		expect(state.doc.toString()).toBe(PASTED);
		expect(state.selection.main.head).toBe(PASTED.length);
	});

	it("pastes at the end of a document", () => {
		const doc = "x = 1\n";
		const state = paste(createView(doc, EditorSelection.cursor(doc.length)));
		expect(state.doc.toString()).toBe(doc + PASTED);
		expect(state.selection.main.head).toBe(state.doc.length);
	});

	it("pastes mid-document and places the cursor right after the text", () => {
		const state = paste(createView("startend", EditorSelection.cursor(5)));
		expect(state.doc.toString()).toBe(`start${PASTED}end`);
		expect(state.selection.main.head).toBe(5 + PASTED.length);
	});

	it("replaces a selected range", () => {
		const state = paste(createView("a[old]b", EditorSelection.range(1, 6)));
		expect(state.doc.toString()).toBe(`a${PASTED}b`);
		expect(state.selection.main.head).toBe(1 + PASTED.length);
	});

	it("pastes at every cursor of a multi-selection", () => {
		const state = paste(
			createView(
				"ab",
				EditorSelection.create([
					EditorSelection.cursor(1),
					EditorSelection.cursor(2),
				]),
			),
		);
		expect(state.doc.toString()).toBe(`a${PASTED}b${PASTED}`);
		expect(state.selection.ranges.map((range) => range.head)).toEqual([
			1 + PASTED.length,
			state.doc.length,
		]);
	});
});

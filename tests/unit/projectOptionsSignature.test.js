import { readFileSync } from "node:fs";
import vm from "node:vm";
import { parse } from "@babel/parser";
import { describe, expect, it, vi } from "vitest";

// The functions under test are closures inside EditorManager, so they are cut
// out of the real source and run against a small fake of what they close over.
const source = readFileSync("src/lib/editorManager.js", "utf8");
const managerBody = parse(source, {
	sourceType: "module",
	plugins: ["jsx"],
}).program.body.find(
	(node) =>
		node.type === "FunctionDeclaration" && node.id.name === "EditorManager",
).body.body;

function sourceOf(name) {
	const node = managerBody.find(
		(item) => item.type === "FunctionDeclaration" && item.id.name === name,
	);
	if (!node) throw new Error(`EditorManager has no function ${name}`);
	return source.slice(node.start, node.end);
}

const OPTION_KEYS = ["tabSize", "softTab"];

function setup(globalSettings = { tabSize: 2, softTab: true }) {
	const project = { values: {} };
	const appSettings = { value: { ...globalSettings, editorTheme: "one_dark" } };
	const workspace = {
		// What the real workspace does: the project's overrides win.
		resolveSettings: (base, uri) =>
			uri?.startsWith("file:///project/")
				? { ...base, ...project.values }
				: base,
	};

	// Stands in for the CodeMirror view. Its state remembers which values the
	// options were last applied with, which is what a user would see.
	const editor = { state: { tabSize: null }, setTheme: vi.fn() };
	const pane = { editor, activeFile: null };
	const panes = [pane];

	// The real applyOptions resolves the file's project overrides and
	// reconfigures the compartments of the keys asked for (all when null).
	function applyOptions(keys, target = editor, file = null) {
		const values = workspace.resolveSettings(
			appSettings.value,
			(file || pane.activeFile).uri,
		);
		for (const key of keys || OPTION_KEYS) {
			if (OPTION_KEYS.includes(key)) target.state[key] = values[key];
		}
	}

	const sandbox = {
		appSettings,
		workspace,
		editor,
		panes,
		applyOptions: vi.fn(applyOptions),
		cmOptionSpecs: [{ keys: OPTION_KEYS }],
		PROJECT_SETTING_KEYS: OPTION_KEYS,
		getEditorCompatibilityPane: () => null,
		touchSelectionController: { onSessionChanged() {} },
		reconfigureEditorReadOnly() {},
		readOnlyCompartment: {},
		warnRecoverable() {},
	};
	const { applyCurrentEditorOptions, reapplyProjectOptions } =
		vm.runInNewContext(
			`${sourceOf("getEditorOptionsSignature")}
		${sourceOf("applyCurrentEditorOptions")}
		${sourceOf("reapplyProjectOptions")}
		({ applyCurrentEditorOptions, reapplyProjectOptions })`,
			sandbox,
		);

	const file = {
		type: "editor",
		uri: "file:///project/a.js",
		editable: true,
		loading: false,
	};
	pane.activeFile = file;

	return {
		editor,
		file,
		project,
		sandbox,
		/** Show the file: what happens when its tab is activated. */
		show() {
			pane.activeFile = file;
			editor.state = file.session ?? editor.state;
			applyCurrentEditorOptions(file, { targetEditor: editor });
		},
		/** Show another file: the editor's state is kept on the file. */
		hide() {
			file.session = editor.state;
			editor.state = { tabSize: null };
			pane.activeFile = null;
		},
		/** The project's settings.json changed; the workspace says so. */
		projectChanges(values) {
			project.values = values;
			reapplyProjectOptions();
		},
	};
}

describe("project options and the saved options signature", () => {
	it("applies the project's options when a file is first shown", () => {
		const t = setup();
		t.project.values = { tabSize: 4 };
		t.show();
		expect(t.editor.state.tabSize).toBe(4);
	});

	it("applies a change to the project while its file is visible", () => {
		const t = setup();
		t.project.values = { tabSize: 4 };
		t.show();

		t.projectChanges({ tabSize: 8 });
		expect(t.editor.state.tabSize).toBe(8);
	});

	it("does not restore old indentation when the project goes back while the file is hidden", () => {
		const t = setup();
		t.project.values = { tabSize: 4 };
		t.show();
		expect(t.editor.state.tabSize).toBe(4);

		// Changed while the file is visible...
		t.projectChanges({ tabSize: 8 });
		expect(t.editor.state.tabSize).toBe(8);

		// ...then the user switches away, and the project returns to its
		// earlier value while the file is not showing.
		t.hide();
		t.project.values = { tabSize: 4 };

		t.show();
		expect(t.editor.state.tabSize).toBe(4);
	});

	it("does not keep project indentation after the project closes while the file is hidden", () => {
		// The file is showing before its project has been scanned.
		const t = setup({ tabSize: 2, softTab: true });
		t.show();
		expect(t.editor.state.tabSize).toBe(2);

		// The scan finishes: the project's settings now apply to what is showing.
		t.projectChanges({ tabSize: 8 });
		expect(t.editor.state.tabSize).toBe(8);

		// The user switches away and the project closes, so the user's own
		// setting applies again. That is what the file was first shown with.
		t.hide();
		t.project.values = {};

		t.show();
		expect(t.editor.state.tabSize).toBe(2);
	});

	it("follows a project that changed to a new value while the file was hidden", () => {
		const t = setup();
		t.project.values = { tabSize: 4 };
		t.show();
		t.projectChanges({ tabSize: 8 });
		t.hide();

		t.project.values = { tabSize: 6 };

		t.show();
		expect(t.editor.state.tabSize).toBe(6);
	});

	it("still skips reapplying every option when nothing changed", () => {
		const t = setup();
		t.project.values = { tabSize: 4 };
		t.show();
		t.hide();
		t.sandbox.applyOptions.mockClear();

		t.show();
		expect(t.sandbox.applyOptions).not.toHaveBeenCalled();
		expect(t.editor.state.tabSize).toBe(4);
	});
});

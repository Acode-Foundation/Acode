import { expect, it, vi } from "vitest";
import { loadSourceModule } from "../helpers/loadSourceModule";

async function loadRegistry() {
	const keyBindingUtils = await import("cm/keyBindingUtils");
	const stubs = Object.fromEntries(
		[
			"fileSystem",
			"@codemirror/commands",
			"@codemirror/language",
			"@codemirror/lint",
			"@codemirror/lsp-client",
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
			...stubs,
			"@codemirror/state": {
				Compartment: class {
					of(extension) {
						return extension;
					}
					reconfigure(extension) {
						return { reconfigure: extension };
					}
				},
				EditorSelection: {},
			},
			"@codemirror/view": { keymap: { of: (bindings) => ({ bindings }) } },
			"cm/keyBindingUtils": keyBindingUtils,
			"lib/keyBindings": {
				__esModule: true,
				default: {},
				APP_KEY_BINDING_NAMES: new Set(),
				CODEMIRROR_COMMAND_NAMES: new Set(),
			},
		},
		{ editorManager: {} },
	);
}

const appliedKeys = (view, call) =>
	view.dispatch.mock.calls[call][0].effects.reconfigure.bindings.map(
		(binding) => binding.key,
	);

it("applies a burst of command registrations to the editor once, keeping reads current", async () => {
	const registry = await loadRegistry();
	const view = { dispatch: vi.fn() };

	const first = registry.registerExternalCommand({
		name: "pluginFirst",
		exec() {},
		bindKey: "Ctrl-Alt-A",
	});
	registry.refreshCommandKeymap(view);
	registry.registerExternalCommand({
		name: "pluginSecond",
		exec() {},
		bindKey: { win: "Ctrl-Alt-B" },
	});
	registry.refreshCommandKeymap(view);

	// The returned command and registry reads are up to date immediately.
	expect(first.key).toBe("Ctrl-Alt-A");
	expect(
		registry
			.getRegisteredCommands()
			.filter(({ name }) => name.startsWith("plugin"))
			.map(({ name, key }) => [name, key]),
	).toEqual([
		["pluginFirst", "Ctrl-Alt-A"],
		["pluginSecond", "Ctrl-Alt-B"],
	]);

	// The editor is reconfigured once, before any later event can run.
	expect(view.dispatch).not.toHaveBeenCalled();
	await Promise.resolve();
	expect(view.dispatch).toHaveBeenCalledOnce();
	expect(appliedKeys(view, 0)).toEqual(
		expect.arrayContaining(["Mod-Alt-a", "Mod-Alt-b"]),
	);

	registry.removeExternalCommand("pluginFirst");
	registry.refreshCommandKeymap(view);
	await Promise.resolve();
	expect(view.dispatch).toHaveBeenCalledTimes(2);
	expect(appliedKeys(view, 1)).not.toContain("Mod-Alt-a");
	expect(appliedKeys(view, 1)).toContain("Mod-Alt-b");
});

it("reports a shortcut conflict with the earlier registered command", async () => {
	const registry = await loadRegistry();
	registry.registerExternalCommand({
		name: "pluginOwner",
		exec() {},
		bindKey: "Ctrl-K",
	});
	registry.registerExternalCommand({
		name: "pluginChord",
		exec() {},
		bindKey: "Ctrl-K Ctrl-X",
	});

	expect(registry.getKeyBindingConflicts()).toEqual([
		{
			key: "Mod-k Mod-x",
			command: "pluginChord",
			shadowedBy: "pluginOwner",
		},
	]);
});

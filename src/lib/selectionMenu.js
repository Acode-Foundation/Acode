import { focusEditorIfEditable } from "cm/editorReadOnly";
import appSettings from "lib/settings";

const exec = (command) => {
	const { editor } = editorManager;
	editor.execCommand(command);

	if (command === "selectall") {
		editor.scrollToRow(Number.POSITIVE_INFINITY);
		editor.setSelection(true);
		editor.setMenu(true);
	}
	focusEditorIfEditable(editor);
};

const showCodeActions = async () => {
	const { editor } = editorManager;
	if (!editor) return;

	try {
		const { showCodeActionsMenu, supportsCodeActions } = await import("cm/lsp");
		if (supportsCodeActions(editor)) {
			await showCodeActionsMenu(editor);
		}
	} catch (error) {
		console.warn("[SelectionMenu] Code actions not available:", error);
	}
};

const showLspActions = async () => {
	const { editor } = editorManager;
	if (!editor) return;

	try {
		const lsp = await import("cm/lsp");
		const { LSPPlugin } = await import("@codemirror/lsp-client");
		const hasCapability = (feature, capability) =>
			LSPPlugin.getAll(editor, feature).some(
				(plugin) => !!plugin.client.serverCapabilities?.[capability],
			);
		const editable = !editor.state.readOnly;
		const actions = [
			hasCapability("definition", "definitionProvider") && {
				value: "definition",
				text: getLabel("go to definition", "Go to Definition"),
				icon: "keyboard_arrow_right",
				run: lsp.goToDefinition,
			},
			hasCapability("declaration", "declarationProvider") && {
				value: "declaration",
				text: getLabel("go to declaration", "Go to Declaration"),
				icon: "keyboard_arrow_right",
				run: lsp.goToDeclaration,
			},
			hasCapability("implementation", "implementationProvider") && {
				value: "implementation",
				text: getLabel("go to implementation", "Go to Implementation"),
				icon: "keyboard_arrow_right",
				run: lsp.goToImplementation,
			},
			hasCapability("typeDefinition", "typeDefinitionProvider") && {
				value: "type-definition",
				text: getLabel("go to type definition", "Go to Type Definition"),
				icon: "keyboard_arrow_right",
				run: lsp.goToTypeDefinition,
			},
			hasCapability("references", "referencesProvider") && {
				value: "references",
				text: getLabel("find references", "Find References"),
				icon: "linkinsert_link",
				run: lsp.findAllReferences,
			},
			editable &&
				hasCapability("rename", "renameProvider") && {
					value: "rename",
					text: getLabel("rename symbol", "Rename Symbol"),
					icon: "edit",
					run: lsp.renameSymbol,
				},
		].filter(Boolean);

		if (!actions.length) return;
		// Let the tap/click that opened this picker finish before its rows exist.
		// Otherwise Android WebView can deliver that click to the first row.
		await new Promise((resolve) => setTimeout(resolve, 0));
		const { default: select } = await import("dialogs/select");
		const selected = await select(
			getLabel("lsp actions", "LSP Actions"),
			actions,
		).catch(() => null);
		const action = actions.find((item) => item.value === selected);
		if (action) await action.run(editor);
	} catch (error) {
		console.warn("[SelectionMenu] LSP actions not available:", error);
	}
};

const items = [];

export default function selectionMenu(options = {}) {
	const { codeActionsAvailable = true, lspActionsAvailable = true } = options;
	return [
		item(
			() => exec("copy"),
			<span className="icon copy"></span>,
			"selected",
			true,
			{ id: "copy", label: getLabel("copy", "Copy") },
		),
		item(
			() => exec("cut"),
			<span className="icon cut"></span>,
			"selected",
			false,
			{
				id: "cut",
				label: getLabel("cut", "Cut"),
			},
		),
		item(
			() => exec("paste"),
			<span className="icon paste"></span>,
			"all",
			false,
			{
				id: "paste",
				label: getLabel("paste", "Paste"),
			},
		),
		item(
			() => exec("selectall"),
			<span className="icon text_format"></span>,
			"all",
			true,
			{ id: "select-all", label: getLabel("select all", "Select all") },
		),
		appSettings.get("showShareButton") &&
			item(
				() => exec("share"),
				<span className="icon share"></span>,
				"selected",
				true,
				{ id: "share", label: getLabel("share", "Share") },
			),
		item(
			(color) => acode.exec("insert-color", color),
			<span className="icon color_lenspalette"></span>,
			"all",
			false,
			{ id: "insert-color", label: getLabel("insert color", "Insert color") },
		),
		codeActionsAvailable &&
			item(
				() => showCodeActions(),
				<span className="icon lightbulb"></span>,
				"all",
				true,
				{
					id: "code-actions",
					label: getLabel("code actions", "Code Actions"),
				},
			),
		lspActionsAvailable &&
			item(
				() => showLspActions(),
				<span className="icon zap"></span>,
				"all",
				true,
				{
					id: "lsp-actions",
					label: getLabel("lsp actions", "LSP Actions"),
				},
			),
		...items,
	].filter(Boolean);
}

/**
 *
 * @param {function} onclick function to be called when the item is clicked
 * @param {string | HTMLElement} text content of the item
 * @param {'selected'|'all'} mode mode supported by the item
 * @param {boolean} readOnly whether to show the item in readOnly mode
 * @param {{id?: string, label?: string}} options display metadata
 */
selectionMenu.add = (onclick, text, mode, readOnly, options) => {
	items.push(item(onclick, text, mode, readOnly, options));
};

selectionMenu.exec = (command) => {
	exec(command);
};

function item(onclick, text, mode = "all", readOnly = false, options = {}) {
	return { onclick, text, mode, readOnly, ...options };
}

function getLabel(key, fallback) {
	return globalThis.strings?.[key] || fallback;
}

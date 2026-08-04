import appSettings from "lib/settings";

function suppressResidualTouch(duration = 350) {
	const swallow = (event) => {
		event.stopPropagation();
		event.preventDefault();
	};
	document.addEventListener("click", swallow, true);
	document.addEventListener("pointerup", swallow, true);
	setTimeout(() => {
		document.removeEventListener("click", swallow, true);
		document.removeEventListener("pointerup", swallow, true);
	}, duration);
}

const exec = (command) => {
	const { editor } = editorManager;
	editor.execCommand(command);

	if (command === "selectall") {
		editor.scrollToRow(Number.POSITIVE_INFINITY);
		editor.setSelection(true);
		editor.setMenu(true);
	}
	editor.focus();
};

const showLspMenu = async () => {
	suppressResidualTouch();

	const { editor } = editorManager;
	if (!editor) return;

	let lsp;
	try {
		lsp = await import("cm/lsp");
	} catch (error) {
		console.warn("[SelectionMenu] LSP module not available:", error);
		return;
	}

	const { LSPPlugin } = await import("@codemirror/lsp-client");
	const plugin = LSPPlugin.get(editor);
	if (!plugin) return;

	const capabilities = plugin.client.serverCapabilities || {};

	const actions = [
		capabilities.definitionProvider && {
			value: "definition",
			text: "Go to Definition",
			icon: "keyboard_arrow_right",
			run: lsp.goToDefinition,
		},
		capabilities.declarationProvider && {
			value: "declaration",
			text: "Go to Declaration",
			icon: "keyboard_arrow_right",
			run: lsp.goToDeclaration,
		},
		capabilities.implementationProvider && {
			value: "implementation",
			text: "Go to Implementation",
			icon: "keyboard_arrow_right",
			run: lsp.goToImplementation,
		},
		capabilities.typeDefinitionProvider && {
			value: "typeDefinition",
			text: "Go to Type Definition",
			icon: "keyboard_arrow_right",
			run: lsp.goToTypeDefinition,
		},
		capabilities.referencesProvider && {
			value: "references",
			text: "Find References",
			icon: "linkinsert_link",
			run: lsp.findAllReferences,
		},
		capabilities.renameProvider && {
			value: "rename",
			text: "Rename Symbol",
			icon: "edit",
			run: lsp.renameSymbol,
		},
		lsp.supportsCodeActions(editor) && {
			value: "codeActions",
			text: "Code Actions",
			icon: "lightbulb",
			run: lsp.showCodeActionsMenu,
		},
	].filter(Boolean);

	if (actions.length === 0) return;

	// Skip the picker entirely if there's only one thing to offer
	if (actions.length === 1) {
		await actions[0].run(editor);
		return;
	}
	const { default: select } = await import("dialogs/select");
	const chosen = await select("LSP Actions", actions).catch(() => null);
	const action = actions.find((a) => a.value === chosen);
	if (action) await action.run(editor);
};

const items = [];

export default function selectionMenu() {
	return [
		item(
			() => exec("copy"),
			<span className="icon copy"></span>,
			"selected",
			true,
		),
		item(() => exec("cut"), <span className="icon cut"></span>, "selected"),
		item(() => exec("paste"), <span className="icon paste"></span>, "all"),
		item(
			() => exec("selectall"),
			<span className="icon text_format"></span>,
			"all",
			true,
		),
		appSettings.get("showShareButton") &&
			item(
				() => exec("share"),
				<span className="icon share"></span>,
				"selected",
				true,
			),
		item(
			(color) => acode.exec("insert-color", color),
			<span className="icon color_lenspalette"></span>,
			"all",
		),
		item(
			() => showLspMenu(),
			<span className="icon lightbulb" title="LSP Actions"></span>,
			"all",
			true,
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
 */
selectionMenu.add = (onclick, text, mode, readOnly) => {
	items.push(item(onclick, text, mode, readOnly));
};

selectionMenu.exec = (command) => {
	exec(command);
};

function item(onclick, text, mode = "all", readOnly = false) {
	return { onclick, text, mode, readOnly };
}

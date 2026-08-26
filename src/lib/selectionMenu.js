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

const items = [];

export default function selectionMenu(options = {}) {
	const { codeActionsAvailable = true } = options;
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

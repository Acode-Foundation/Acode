import { LSPPlugin } from "@codemirror/lsp-client";
import {
	type Command,
	EditorView,
	type KeyBinding,
	keymap,
} from "@codemirror/view";
import prompt from "dialogs/prompt";
import type * as lsp from "vscode-languageserver-protocol";
import type AcodeWorkspace from "./workspace";

interface RenameParams {
	newName: string;
	position: lsp.Position;
	textDocument: { uri: string };
}

interface TextDocumentEdit {
	range: lsp.Range;
	newText: string;
}

interface PrepareRenameResponse {
	range?: lsp.Range;
	placeholder?: string;
	defaultBehavior?: boolean;
}

interface LspChange {
	range: lsp.Range;
	newText: string;
}

function getRename(plugin: LSPPlugin, pos: number, newName: string) {
	return plugin.client.request<RenameParams, lsp.WorkspaceEdit | null>(
		"textDocument/rename",
		{
			newName,
			position: plugin.toPosition(pos),
			textDocument: { uri: plugin.uri },
		},
	);
}

function getPrepareRename(plugin: LSPPlugin, pos: number) {
	return plugin.client.request<
		{ position: lsp.Position; textDocument: { uri: string } },
		PrepareRenameResponse | lsp.Range | null
	>("textDocument/prepareRename", {
		position: plugin.toPosition(pos),
		textDocument: { uri: plugin.uri },
	});
}

async function performRename(view: EditorView): Promise<boolean> {
	const wordRange = view.state.wordAt(view.state.selection.main.head);
	const plugin = LSPPlugin.get(view);

	if (!plugin) {
		return false;
	}

	const capabilities = plugin.client.serverCapabilities;
	const renameProvider = capabilities?.renameProvider;

	if (renameProvider === false || renameProvider === undefined) {
		return false;
	}

	if (!wordRange) {
		return false;
	}

	const word = view.state.sliceDoc(wordRange.from, wordRange.to);
	let initialValue = word;
	let canRename = true;

	const supportsPrepare =
		typeof renameProvider === "object" &&
		renameProvider !== null &&
		"prepareProvider" in renameProvider &&
		renameProvider.prepareProvider === true;

	if (supportsPrepare) {
		try {
			plugin.client.sync();
			const prepareResult = await getPrepareRename(plugin, wordRange.from);
			if (prepareResult === null) {
				canRename = false;
			} else if (typeof prepareResult === "object" && prepareResult !== null) {
				if ("placeholder" in prepareResult && prepareResult.placeholder) {
					initialValue = prepareResult.placeholder;
				} else if (
					"defaultBehavior" in prepareResult &&
					prepareResult.defaultBehavior
				) {
					initialValue = word;
				} else if ("start" in prepareResult && "end" in prepareResult) {
					const from = plugin.fromPosition(prepareResult.start);
					const to = plugin.fromPosition(prepareResult.end);
					initialValue = view.state.sliceDoc(from, to);
				} else if ("range" in prepareResult && prepareResult.range) {
					const from = plugin.fromPosition(prepareResult.range.start);
					const to = plugin.fromPosition(prepareResult.range.end);
					initialValue = view.state.sliceDoc(from, to);
				}
			}
		} catch (error) {
			console.warn("[LSP:Rename] prepareRename failed, using word:", error);
		}
	}

	if (!canRename) {
		const alert = (await import("dialogs/alert")).default;
		alert("Rename", "Cannot rename this symbol.");
		return true;
	}

	const newName = await prompt(
		strings["new name"] || "New name",
		initialValue,
		"text",
		{
			required: true,
			placeholder: strings["enter new name"] || "Enter new name",
		},
	);

	if (newName === null || newName === initialValue) {
		return true;
	}

	try {
		await doRename(view, String(newName), wordRange.from);
	} catch (error) {
		console.error("[LSP:Rename] Rename failed:", error);
		const errorMessage =
			error instanceof Error ? error.message : "Failed to rename symbol";
		const alert = (await import("dialogs/alert")).default;
		alert("Rename Error", errorMessage);
	}

	return true;
}

function lspPositionToOffset(
	doc: { line: (n: number) => { from: number } },
	pos: lsp.Position,
): number {
	const line = doc.line(pos.line + 1);
	return line.from + pos.character;
}

async function applyChangesToFile(
	workspace: AcodeWorkspace,
	uri: string,
	lspChanges: LspChange[],
	mapping: { mapPosition: (uri: string, pos: lsp.Position) => number },
): Promise<boolean> {
	const file = workspace.getFile(uri);

	if (file) {
		const view = file.getView();
		if (view) {
			view.dispatch({
				changes: lspChanges.map((change) => ({
					from: mapping.mapPosition(uri, change.range.start),
					to: mapping.mapPosition(uri, change.range.end),
					insert: change.newText,
				})),
				userEvent: "rename",
			});
			return true;
		}
	}

	const displayedView = await workspace.displayFile(uri);
	if (!displayedView?.state?.doc) {
		console.warn(`[LSP:Rename] Could not open file: ${uri}`);
		return false;
	}

	const doc = displayedView.state.doc;
	displayedView.dispatch({
		changes: lspChanges.map((change) => ({
			from: lspPositionToOffset(doc, change.range.start),
			to: lspPositionToOffset(doc, change.range.end),
			insert: change.newText,
		})),
		userEvent: "rename",
	});

	return true;
}

async function doRename(
	view: EditorView,
	newName: string,
	position: number,
): Promise<void> {
	const plugin = LSPPlugin.get(view);
	if (!plugin) return;

	plugin.client.sync();

	const response = await plugin.client.withMapping((mapping) =>
		getRename(plugin, position, newName).then((response) => {
			if (!response) return null;
			return { response, mapping };
		}),
	);

	if (!response) {
		console.info("[LSP:Rename] No changes returned from server");
		return;
	}

	const { response: workspaceEdit, mapping } = response;
	const workspace = plugin.client.workspace as AcodeWorkspace;
	let filesChanged = 0;

	if (workspaceEdit.changes) {
		for (const uri in workspaceEdit.changes) {
			const lspChanges = workspaceEdit.changes[uri] as TextDocumentEdit[];
			if (!lspChanges.length) continue;

			const success = await applyChangesToFile(
				workspace,
				uri,
				lspChanges,
				mapping,
			);
			if (success) filesChanged++;
		}
	}

	if (workspaceEdit.documentChanges) {
		for (const docChange of workspaceEdit.documentChanges) {
			if ("textDocument" in docChange && "edits" in docChange) {
				const uri = docChange.textDocument.uri;
				const edits = docChange.edits as TextDocumentEdit[];
				if (!edits.length) continue;

				const success = await applyChangesToFile(
					workspace,
					uri,
					edits,
					mapping,
				);
				if (success) filesChanged++;
			}
		}
	}

	console.info(
		`[LSP:Rename] Renamed to "${newName}" in ${filesChanged} file(s)`,
	);
}

export const renameSymbol: Command = (view) => {
	performRename(view).catch((error) => {
		console.error("[LSP:Rename] Rename command failed:", error);
	});
	return true;
};

export const acodeRenameKeymap: readonly KeyBinding[] = [
	{ key: "F2", run: renameSymbol, preventDefault: true },
];

export const acodeRenameExtension = () => keymap.of([...acodeRenameKeymap]);

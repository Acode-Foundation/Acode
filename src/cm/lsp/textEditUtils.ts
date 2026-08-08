import type { LSPPlugin } from "@codemirror/lsp-client";
import type { EditorView } from "@codemirror/view";
import { MapMode } from "@codemirror/state";
import type { Text } from "@codemirror/state";
import type { TextEdit } from "vscode-languageserver-types";

interface Change {
	from: number;
	to: number;
	insert: string;
}

/**
 * Convert an LSP Position to a CodeMirror document offset, clamping to
 * document bounds. Handles the LSP convention where line == doc.lines
 * means "end of document" (e.g. full-document formatting replacements).
 */
export function lspPositionToOffset(
	doc: Text,
	pos: { line: number; character: number },
): number {
	if (pos.line < 0) return 0;
	if (pos.line >= doc.lines) return doc.length;
	const line = doc.line(pos.line + 1);
	return line.from + Math.min(pos.character, line.length);
}

/**
 * Apply a list of LSP TextEdits to an EditorView backed by the given
 * LSPPlugin. Shared by clientManager.ts (edits the client pulls, e.g.
 * textDocument/formatting) and transport.ts (edits the server pushes,
 * e.g. workspace/applyEdit).
 */
export function applyTextEdits(
	plugin: LSPPlugin,
	view: EditorView,
	edits: TextEdit[],
): boolean {
	const changes: Change[] = [];
	for (const edit of edits) {
		if (!edit?.range) continue;
		let fromBase: number;
		let toBase: number;
		try {
			fromBase = lspPositionToOffset(plugin.syncedDoc, edit.range.start);
			toBase = lspPositionToOffset(plugin.syncedDoc, edit.range.end);
		} catch (err) {
			console.error("[applyTextEdits] position conversion failed:", err, edit);
			continue;
		}
		const fromResult = plugin.unsyncedChanges.mapPos(
			fromBase,
			1,
			MapMode.TrackDel,
		);
		const toResult = plugin.unsyncedChanges.mapPos(
			toBase,
			-1,
			MapMode.TrackDel,
		);
		if (fromResult == null || toResult == null) continue;
		const insert =
			typeof edit.newText === "string"
				? edit.newText.replace(/\r\n/g, "\n")
				: "";
		changes.push({ from: fromResult, to: toResult, insert });
	}
	if (!changes.length) return false;
	changes.sort((a, b) => a.from - b.from || a.to - b.to);
	view.dispatch({ changes });
	return true;
}
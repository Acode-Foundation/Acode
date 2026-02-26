import fsOperation from "fileSystem";
import { LSPPlugin } from "@codemirror/lsp-client";
import type { EditorView } from "@codemirror/view";
import {
	openReferencesTab,
	showReferencesPanel,
} from "components/referencesPanel";
import settings from "lib/settings";

interface Position {
	line: number;
	character: number;
}

interface Range {
	start: Position;
	end: Position;
}

interface Location {
	uri: string;
	range: Range;
}

interface ReferenceWithContext extends Location {
	lineText?: string;
}

interface ReferenceParams {
	textDocument: { uri: string };
	position: Position;
	context: { includeDeclaration: boolean };
}

async function fetchLineText(uri: string, line: number): Promise<string> {
	try {
		interface EditorManagerLike {
			getFile?: (uri: string, type: string) => EditorFileLike | null;
		}

		interface EditorFileLike {
			session?: {
				doc?: {
					line?: (n: number) => { text?: string } | null;
					toString?: () => string;
				};
			};
		}

		const em = (globalThis as Record<string, unknown>).editorManager as
			| EditorManagerLike
			| undefined;

		const openFile = em?.getFile?.(uri, "uri");
		if (openFile?.session?.doc) {
			const doc = openFile.session.doc;
			if (typeof doc.line === "function") {
				const lineObj = doc.line(line + 1);
				if (lineObj && typeof lineObj.text === "string") {
					return lineObj.text;
				}
			}
			if (typeof doc.toString === "function") {
				const content = doc.toString();
				const lines = content.split("\n");
				if (lines[line] !== undefined) {
					return lines[line];
				}
			}
		}

		const fs = fsOperation(uri);
		if (fs && (await fs.exists())) {
			const encoding =
				(settings as { value?: { defaultFileEncoding?: string } })?.value
					?.defaultFileEncoding || "utf-8";
			const content = await fs.readFile(encoding);
			if (typeof content === "string") {
				const lines = content.split("\n");
				if (lines[line] !== undefined) {
					return lines[line];
				}
			}
		}
	} catch (error) {
		console.warn(`Failed to fetch line text for ${uri}:${line}`, error);
	}
	return "";
}

function getWordAtCursor(view: EditorView): string {
	const { state } = view;
	const pos = state.selection.main.head;
	const word = state.wordAt(pos);
	if (word) {
		return state.doc.sliceString(word.from, word.to);
	}
	return "";
}

async function fetchReferences(
	view: EditorView,
): Promise<{ symbolName: string; references: ReferenceWithContext[] } | null> {
	const plugin = LSPPlugin.get(view);
	if (!plugin) {
		return null;
	}

	const client = plugin.client;
	const capabilities = client.serverCapabilities;

	if (!capabilities?.referencesProvider) {
		const toast = (globalThis as Record<string, unknown>).toast as
			| ((msg: string) => void)
			| undefined;
		toast?.("Language server does not support find references");
		return null;
	}

	const { state } = view;
	const pos = state.selection.main.head;
	const line = state.doc.lineAt(pos);
	const lineNumber = line.number - 1;
	const character = pos - line.from;
	const uri = plugin.uri;

	const symbolName = getWordAtCursor(view);

	client.sync();

	const params: ReferenceParams = {
		textDocument: { uri },
		position: { line: lineNumber, character },
		context: { includeDeclaration: true },
	};

	const locations = await client.request<ReferenceParams, Location[] | null>(
		"textDocument/references",
		params,
	);

	if (!locations || locations.length === 0) {
		return { symbolName, references: [] };
	}

	const refsWithContext: ReferenceWithContext[] = await Promise.all(
		locations.map(async (loc) => {
			const lineText = await fetchLineText(loc.uri, loc.range.start.line);
			return {
				...loc,
				lineText,
			};
		}),
	);

	return { symbolName, references: refsWithContext };
}

export async function findAllReferences(view: EditorView): Promise<boolean> {
	const plugin = LSPPlugin.get(view);
	if (!plugin) {
		return false;
	}

	const symbolName = getWordAtCursor(view);
	const panel = showReferencesPanel({ symbolName });

	try {
		const result = await fetchReferences(view);
		if (result === null) {
			panel.setError("Failed to fetch references");
			return false;
		}
		panel.setReferences(result.references);
		return true;
	} catch (error) {
		console.error("Find references failed:", error);
		const errorMessage =
			error instanceof Error ? error.message : "Unknown error occurred";
		panel.setError(errorMessage);
		return false;
	}
}

export async function findAllReferencesInTab(
	view: EditorView,
): Promise<boolean> {
	const plugin = LSPPlugin.get(view);
	if (!plugin) {
		const toast = (globalThis as Record<string, unknown>).toast as
			| ((msg: string) => void)
			| undefined;
		toast?.("Language server not available");
		return false;
	}

	try {
		const result = await fetchReferences(view);
		if (result === null) {
			return false;
		}

		if (result.references.length === 0) {
			const toast = (globalThis as Record<string, unknown>).toast as
				| ((msg: string) => void)
				| undefined;
			toast?.("No references found");
			return true;
		}

		openReferencesTab({
			symbolName: result.symbolName,
			references: result.references,
		});
		return true;
	} catch (error) {
		console.error("Find references in tab failed:", error);
		return false;
	}
}

export function closeReferencesPanel(): boolean {
	const { hideReferencesPanel } = require("components/referencesPanel");
	hideReferencesPanel();
	return true;
}

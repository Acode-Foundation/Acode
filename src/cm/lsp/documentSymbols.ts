/**
 * LSP Document Symbols Extension for CodeMirror
 *
 * Provides document symbol information (functions, classes, variables, etc.) from language servers.
 */

import { LSPPlugin } from "@codemirror/lsp-client";
import type { EditorView } from "@codemirror/view";
import type {
	DocumentSymbol,
	Position,
	Range,
	SymbolInformation,
	SymbolKind,
} from "vscode-languageserver-types";
import type { LSPPluginAPI } from "./types";

interface DocumentSymbolParams {
	textDocument: { uri: string };
}

export interface ProcessedSymbol {
	name: string;
	kind: SymbolKind;
	kindName: string;
	detail?: string;
	range: {
		startLine: number;
		startCharacter: number;
		endLine: number;
		endCharacter: number;
	};
	selectionRange: {
		startLine: number;
		startCharacter: number;
		endLine: number;
		endCharacter: number;
	};
	children?: ProcessedSymbol[];
	depth: number;
	containerName?: string;
}

export interface FlatSymbol {
	name: string;
	kind: SymbolKind;
	kindName: string;
	detail?: string;
	line: number;
	character: number;
	endLine: number;
	endCharacter: number;
	containerName?: string;
	depth: number;
}

const SYMBOL_KIND_NAMES: Record<SymbolKind, string> = {
	1: "File",
	2: "Module",
	3: "Namespace",
	4: "Package",
	5: "Class",
	6: "Method",
	7: "Property",
	8: "Field",
	9: "Constructor",
	10: "Enum",
	11: "Interface",
	12: "Function",
	13: "Variable",
	14: "Constant",
	15: "String",
	16: "Number",
	17: "Boolean",
	18: "Array",
	19: "Object",
	20: "Key",
	21: "Null",
	22: "EnumMember",
	23: "Struct",
	24: "Event",
	25: "Operator",
	26: "TypeParameter",
};

const SYMBOL_KIND_ICONS: Record<SymbolKind, string> = {
	1: "insert_drive_file",
	2: "view_module",
	3: "view_module",
	4: "folder",
	5: "class",
	6: "functions",
	7: "label",
	8: "label",
	9: "functions",
	10: "list",
	11: "category",
	12: "functions",
	13: "code",
	14: "lock",
	15: "text_fields",
	16: "pin",
	17: "toggle_on",
	18: "data_array",
	19: "data_object",
	20: "key",
	21: "not_interested",
	22: "list",
	23: "data_object",
	24: "bolt",
	25: "calculate",
	26: "text_fields",
};

export function getSymbolKindName(kind: SymbolKind): string {
	return SYMBOL_KIND_NAMES[kind] || "Unknown";
}

export function getSymbolKindIcon(kind: SymbolKind): string {
	return SYMBOL_KIND_ICONS[kind] || "code";
}

function isDocumentSymbol(
	item: DocumentSymbol | SymbolInformation,
): item is DocumentSymbol {
	return "selectionRange" in item;
}

function processDocumentSymbol(
	symbol: DocumentSymbol,
	depth = 0,
	containerName?: string,
): ProcessedSymbol {
	const processed: ProcessedSymbol = {
		name: symbol.name,
		kind: symbol.kind,
		kindName: getSymbolKindName(symbol.kind),
		detail: symbol.detail,
		range: {
			startLine: symbol.range.start.line,
			startCharacter: symbol.range.start.character,
			endLine: symbol.range.end.line,
			endCharacter: symbol.range.end.character,
		},
		selectionRange: {
			startLine: symbol.selectionRange.start.line,
			startCharacter: symbol.selectionRange.start.character,
			endLine: symbol.selectionRange.end.line,
			endCharacter: symbol.selectionRange.end.character,
		},
		depth,
		containerName,
	};

	if (symbol.children && symbol.children.length > 0) {
		processed.children = symbol.children.map((child) =>
			processDocumentSymbol(child, depth + 1, symbol.name),
		);
	}

	return processed;
}

function processSymbolInformation(
	symbol: SymbolInformation,
	depth = 0,
): ProcessedSymbol {
	return {
		name: symbol.name,
		kind: symbol.kind,
		kindName: getSymbolKindName(symbol.kind),
		range: {
			startLine: symbol.location.range.start.line,
			startCharacter: symbol.location.range.start.character,
			endLine: symbol.location.range.end.line,
			endCharacter: symbol.location.range.end.character,
		},
		selectionRange: {
			startLine: symbol.location.range.start.line,
			startCharacter: symbol.location.range.start.character,
			endLine: symbol.location.range.end.line,
			endCharacter: symbol.location.range.end.character,
		},
		containerName: symbol.containerName,
		depth,
	};
}

function flattenSymbols(
	symbols: ProcessedSymbol[],
	result: FlatSymbol[] = [],
): FlatSymbol[] {
	for (const symbol of symbols) {
		result.push({
			name: symbol.name,
			kind: symbol.kind,
			kindName: symbol.kindName,
			detail: symbol.detail,
			line: symbol.selectionRange.startLine,
			character: symbol.selectionRange.startCharacter,
			endLine: symbol.selectionRange.endLine,
			endCharacter: symbol.selectionRange.endCharacter,
			containerName: symbol.containerName,
			depth: symbol.depth,
		});

		if (symbol.children) {
			flattenSymbols(symbol.children, result);
		}
	}

	return result;
}

export async function fetchDocumentSymbols(
	view: EditorView,
): Promise<ProcessedSymbol[] | null> {
	const plugin = LSPPlugin.get(view) as LSPPluginAPI | null;
	if (!plugin) {
		return null;
	}

	const client = plugin.client;
	const capabilities = client.serverCapabilities;

	if (!capabilities?.documentSymbolProvider) {
		return null;
	}

	client.sync();

	const params: DocumentSymbolParams = {
		textDocument: { uri: plugin.uri },
	};

	try {
		const response = await client.request<
			DocumentSymbolParams,
			(DocumentSymbol | SymbolInformation)[] | null
		>("textDocument/documentSymbol", params);

		if (!response || response.length === 0) {
			return [];
		}

		if (isDocumentSymbol(response[0])) {
			return (response as DocumentSymbol[]).map((sym) =>
				processDocumentSymbol(sym),
			);
		}

		return (response as SymbolInformation[]).map((sym) =>
			processSymbolInformation(sym),
		);
	} catch (error) {
		console.warn("Failed to fetch document symbols:", error);
		return null;
	}
}

export async function getDocumentSymbolsFlat(
	view: EditorView,
): Promise<FlatSymbol[]> {
	const symbols = await fetchDocumentSymbols(view);
	if (!symbols) {
		return [];
	}

	return flattenSymbols(symbols);
}

export async function navigateToSymbol(
	view: EditorView,
	symbol: FlatSymbol | ProcessedSymbol,
): Promise<boolean> {
	try {
		const doc = view.state.doc;
		let targetLine: number;
		let targetChar: number;

		if ("line" in symbol) {
			targetLine = symbol.line;
			targetChar = symbol.character;
		} else {
			targetLine = symbol.selectionRange.startLine;
			targetChar = symbol.selectionRange.startCharacter;
		}

		const lineNumber = targetLine + 1;
		if (lineNumber < 1 || lineNumber > doc.lines) {
			return false;
		}

		const line = doc.line(lineNumber);
		const pos = Math.min(line.from + targetChar, line.to);

		view.dispatch({
			selection: { anchor: pos },
			scrollIntoView: true,
		});

		view.focus();
		return true;
	} catch (error) {
		console.warn("Failed to navigate to symbol:", error);
		return false;
	}
}

export function supportsDocumentSymbols(view: EditorView): boolean {
	const plugin = LSPPlugin.get(view) as LSPPluginAPI | null;
	if (!plugin?.client.connected) {
		return false;
	}

	return !!plugin.client.serverCapabilities?.documentSymbolProvider;
}

export interface DocumentSymbolsResult {
	symbols: ProcessedSymbol[];
	flat: FlatSymbol[];
}

export async function getDocumentSymbols(
	view: EditorView,
): Promise<DocumentSymbolsResult | null> {
	const symbols = await fetchDocumentSymbols(view);
	if (symbols === null) {
		return null;
	}

	return {
		symbols,
		flat: flattenSymbols(symbols),
	};
}

export { SymbolKind } from "vscode-languageserver-types";

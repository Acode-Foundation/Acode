import { LSPPlugin } from "@codemirror/lsp-client";
import type { EditorView } from "@codemirror/view";
import { showReferencesPanel } from "components/referencesPanel";
import { fetchLineText, getWordAtCursor } from "./references";
import toast from "components/toast";

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

interface LocationLink {
	targetUri: string;
	targetRange: Range;
	targetSelectionRange?: Range;
}

type DefinitionResult = Location | Location[] | LocationLink[] | null;

interface ReferenceWithContext extends Location {
	lineText?: string;
}

type DefinitionKind =
	| "definition"
	| "declaration"
	| "implementation"
	| "typeDefinition";

const CAPABILITY_KEY: Record<DefinitionKind, string> = {
	definition: "definitionProvider",
	declaration: "declarationProvider",
	implementation: "implementationProvider",
	typeDefinition: "typeDefinitionProvider",
};

const LABEL: Record<DefinitionKind, string> = {
	definition: "definition",
	declaration: "declaration",
	implementation: "implementation",
	typeDefinition: "type definition",
};

function normalizeLocations(result: DefinitionResult): Location[] {
	if (!result) return [];
	const list = Array.isArray(result) ? result : [result];
	return list.map((item) => {
		if ("targetUri" in item) {
			return {
				uri: item.targetUri,
				range: item.targetSelectionRange ?? item.targetRange,
			};
		}
		return item;
	});
}

async function fetchLocations(
	view: EditorView,
	kind: DefinitionKind,
): Promise<Location[] | null> {
	const plugin = LSPPlugin.get(view);
	if (!plugin) return null;

	const client = plugin.client;
	const capabilities = client.serverCapabilities as
		| Record<string, unknown>
		| undefined;

	if (!capabilities?.[CAPABILITY_KEY[kind]]) {
		toast(`Language server does not support go to ${LABEL[kind]}`);
		return null;
	}

	const { state } = view;
	const pos = state.selection.main.head;
	const line = state.doc.lineAt(pos);
	const uri = plugin.uri;

	client.sync();

	const method = `textDocument/${kind}`;
	const params = {
		textDocument: { uri },
		position: { line: line.number - 1, character: pos - line.from },
	};

	const result = await client.request<typeof params, DefinitionResult>(
		method,
		params,
	);

	return normalizeLocations(result);
}

async function goTo(view: EditorView, kind: DefinitionKind): Promise<boolean> {
	try {
		const locations = await fetchLocations(view, kind);
		if (locations === null) return false;

		if (locations.length === 0) {
			toast(`No ${LABEL[kind]} found`);
			return false;
		}

		if (locations.length === 1) {
			const { navigateToReference } = await import(
				"components/referencesPanel/utils"
			);
			await navigateToReference(locations[0]);
			return true;
		}

		const symbolName = getWordAtCursor(view);
		const panel = showReferencesPanel({ symbolName });
		const withContext: ReferenceWithContext[] = await Promise.all(
			locations.map(async (loc) => ({
				...loc,
				lineText: await fetchLineText(loc.uri, loc.range.start.line),
			})),
		);
		panel.setReferences(withContext);
		return true;
	} catch (error) {
		console.error(`Go to ${LABEL[kind]} failed:`, error);
		return false;
	}
}

export const goToDefinition = (view: EditorView) => goTo(view, "definition");
export const goToDeclaration = (view: EditorView) => goTo(view, "declaration");
export const goToImplementation = (view: EditorView) =>
	goTo(view, "implementation");
export const goToTypeDefinition = (view: EditorView) =>
	goTo(view, "typeDefinition");
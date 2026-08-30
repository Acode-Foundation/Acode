import { LSPPlugin } from "@codemirror/lsp-client";
import type { Command, EditorView } from "@codemirror/view";
import { showReferencesPanel } from "components/referencesPanel";
import { navigateToReference } from "components/referencesPanel/utils";
import toast from "components/toast";
import type { ServerCapabilities } from "vscode-languageserver-protocol";
import { normalizeLocations, type LspLocationResult } from "./locationUtils";
import { addLspLogFor } from "./logs";
import { fetchLineText, getWordAtCursor } from "./references";

type DefinitionKind =
	| "definition"
	| "declaration"
	| "implementation"
	| "typeDefinition";

const CAPABILITY: Record<DefinitionKind, keyof ServerCapabilities> = {
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

function locationKey(location: ReturnType<typeof normalizeLocations>[number]) {
	const { start, end } = location.range;
	return `${location.uri}:${start.line}:${start.character}:${end.line}:${end.character}`;
}

async function fetchLocations(
	view: EditorView,
	kind: DefinitionKind,
): Promise<ReturnType<typeof normalizeLocations> | null> {
	const plugins = LSPPlugin.getAll(view, kind).filter(
		(plugin) => !!plugin.client.serverCapabilities?.[CAPABILITY[kind]],
	);
	if (!plugins.length) {
		toast(`Language server does not support go to ${LABEL[kind]}`);
		return null;
	}

	const position = view.state.selection.main.head;
	const settled = await Promise.allSettled(
		plugins.map(async (plugin) => {
			plugin.client.sync();
			return plugin.client.request<
				{
					textDocument: { uri: string };
					position: { line: number; character: number };
				},
				LspLocationResult
			>(`textDocument/${kind}`, {
				textDocument: { uri: plugin.uri },
				position: plugin.toPosition(position),
			});
		}),
	);

	const locations: ReturnType<typeof normalizeLocations> = [];
	const seen = new Set<string>();
	for (let index = 0; index < settled.length; index++) {
		const result = settled[index];
		if (result.status === "rejected") {
			addLspLogFor(
				plugins[index],
				"warn",
				`Go to ${LABEL[kind]} failed`,
				result.reason,
			);
			continue;
		}
		for (const location of normalizeLocations(result.value)) {
			const key = locationKey(location);
			if (seen.has(key)) continue;
			seen.add(key);
			locations.push(location);
		}
	}
	return locations;
}

async function goTo(view: EditorView, kind: DefinitionKind): Promise<boolean> {
	try {
		const locations = await fetchLocations(view, kind);
		if (locations === null) return false;
		if (!locations.length) {
			toast(`No ${LABEL[kind]} found`);
			return true;
		}

		if (locations.length === 1) {
			await navigateToReference(locations[0]);
			return true;
		}

		const symbolName = getWordAtCursor(view);
		const panel = showReferencesPanel({ symbolName });
		panel.setReferences(
			await Promise.all(
				locations.map(async (location) => ({
					...location,
					lineText: await fetchLineText(
						location.uri,
						location.range.start.line,
					),
				})),
			),
		);
		return true;
	} catch (error) {
		console.error(`[LSP:Definition] Go to ${LABEL[kind]} failed:`, error);
		return false;
	}
}

export const jumpToDefinition: Command = (view) => {
	void goTo(view, "definition");
	return true;
};

export const jumpToDeclaration: Command = (view) => {
	void goTo(view, "declaration");
	return true;
};

export const jumpToImplementation: Command = (view) => {
	void goTo(view, "implementation");
	return true;
};

export const jumpToTypeDefinition: Command = (view) => {
	void goTo(view, "typeDefinition");
	return true;
};

export const goToDefinition = (view: EditorView) => goTo(view, "definition");
export const goToDeclaration = (view: EditorView) => goTo(view, "declaration");
export const goToImplementation = (view: EditorView) =>
	goTo(view, "implementation");
export const goToTypeDefinition = (view: EditorView) =>
	goTo(view, "typeDefinition");

import { Diagnostic, forceLinting, linter, lintGutter } from "@codemirror/lint";
import type { LSPClient } from "@codemirror/lsp-client";
import { LSPPlugin } from "@codemirror/lsp-client";
import type { Extension } from "@codemirror/state";
import {
	EditorState,
	MapMode,
	StateEffect,
	StateField,
} from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type {
	LSPClientWithWorkspace,
	LSPPluginAPI,
	LspDiagnostic,
	PublishDiagnosticsParams,
	RawDiagnostic,
} from "./types";

const setPublishedDiagnostics = StateEffect.define<LspDiagnostic[]>();

export const LSP_DIAGNOSTICS_EVENT = "acode:lsp-diagnostics-updated";

function emitDiagnosticsUpdated(): void {
	if (
		typeof document === "undefined" ||
		typeof document.dispatchEvent !== "function"
	) {
		return;
	}

	let event: CustomEvent | Event;
	try {
		event = new CustomEvent(LSP_DIAGNOSTICS_EVENT);
	} catch (_) {
		try {
			event = document.createEvent("CustomEvent");
			(event as CustomEvent).initCustomEvent(
				LSP_DIAGNOSTICS_EVENT,
				false,
				false,
				undefined,
			);
		} catch (_) {
			return;
		}
	}

	document.dispatchEvent(event);
}

const lspPublishedDiagnostics = StateField.define<LspDiagnostic[]>({
	create(): LspDiagnostic[] {
		return [];
	},
	update(value: LspDiagnostic[], tr): LspDiagnostic[] {
		for (const effect of tr.effects) {
			if (effect.is(setPublishedDiagnostics)) {
				value = effect.value;
			}
		}
		return value;
	},
});

type DiagnosticSeverity = "error" | "warning" | "info" | "hint";
const severities: DiagnosticSeverity[] = [
	"hint",
	"error",
	"warning",
	"info",
	"hint",
];

function storeLspDiagnostics(
	plugin: LSPPluginAPI,
	diagnostics: RawDiagnostic[],
): StateEffect<LspDiagnostic[]> {
	const items: LspDiagnostic[] = [];
	const { syncedDoc } = plugin;

	for (const diagnostic of diagnostics) {
		let from: number;
		let to: number;
		try {
			const mappedFrom = plugin.fromPosition(
				diagnostic.range.start,
				plugin.syncedDoc,
			);
			const mappedTo = plugin.fromPosition(
				diagnostic.range.end,
				plugin.syncedDoc,
			);
			const fromResult = plugin.unsyncedChanges.mapPos(mappedFrom);
			const toResult = plugin.unsyncedChanges.mapPos(mappedTo);
			if (fromResult === null || toResult === null) continue;
			from = fromResult;
			to = toResult;
		} catch (_) {
			continue;
		}
		if (to > syncedDoc.length) continue;

		const severity = severities[diagnostic.severity ?? 0] ?? "info";
		const source = diagnostic.code
			? `${diagnostic.source ? `${diagnostic.source}-` : ""}${diagnostic.code}`
			: undefined;

		items.push({
			from,
			to,
			severity,
			message: diagnostic.message,
			source,
		});
	}

	return setPublishedDiagnostics.of(items);
}

function mapDiagnostics(
	plugin: LSPPluginAPI,
	state: EditorState,
): Diagnostic[] {
	plugin.client.sync();
	const stored = state.field(lspPublishedDiagnostics);
	const changes = plugin.unsyncedChanges;
	const mapped: Diagnostic[] = [];

	for (const diagnostic of stored) {
		let from: number | null;
		let to: number | null;
		try {
			from = changes.mapPos(diagnostic.from, 1, MapMode.TrackDel);
			to = changes.mapPos(diagnostic.to, -1, MapMode.TrackDel);
		} catch (_) {
			continue;
		}
		if (from != null && to != null) {
			mapped.push({ ...diagnostic, from, to });
		}
	}

	return mapped;
}

function lspLinterSource(view: EditorView): Diagnostic[] {
	const plugin = LSPPlugin.get(view) as LSPPluginAPI | null;
	if (!plugin) return [];
	return mapDiagnostics(plugin, view.state);
}

export function lspDiagnosticsClientExtension(): {
	clientCapabilities: Record<string, unknown>;
	notificationHandlers: Record<
		string,
		(client: LSPClient, params: PublishDiagnosticsParams) => boolean
	>;
} {
	return {
		clientCapabilities: {
			textDocument: {
				publishDiagnostics: {
					relatedInformation: true,
					codeDescriptionSupport: true,
					dataSupport: true,
					versionSupport: true,
				},
			},
		},
		notificationHandlers: {
			"textDocument/publishDiagnostics": (
				client: LSPClient,
				params: PublishDiagnosticsParams,
			): boolean => {
				const clientWithWorkspace = client as unknown as LSPClientWithWorkspace;
				const file = clientWithWorkspace.workspace.getFile(params.uri);
				if (
					!file ||
					(params.version != null && params.version !== file.version)
				) {
					return false;
				}
				const view = file.getView();
				if (!view) return false;
				const plugin = LSPPlugin.get(view) as LSPPluginAPI | null;
				if (!plugin) return false;

				view.dispatch({
					effects: storeLspDiagnostics(plugin, params.diagnostics),
				});
				forceLinting(view);
				emitDiagnosticsUpdated();
				return true;
			},
		},
	};
}

export function lspDiagnosticsUiExtension(includeGutter = true): Extension[] {
	const extensions: Extension[] = [
		lspPublishedDiagnostics,
		linter(lspLinterSource, {
			needsRefresh(update) {
				return update.transactions.some((tr) =>
					tr.effects.some((effect) => effect.is(setPublishedDiagnostics)),
				);
			},
			// keep panel closed by default
			autoPanel: false,
		}),
	];
	if (includeGutter) {
		extensions.splice(1, 0, lintGutter());
	}
	return extensions;
}

interface DiagnosticsExtension {
	clientCapabilities: Record<string, unknown>;
	notificationHandlers: Record<
		string,
		(client: LSPClient, params: PublishDiagnosticsParams) => boolean
	>;
	editorExtension: Extension[];
}

export function lspDiagnosticsExtension(
	includeGutter = true,
): DiagnosticsExtension {
	return {
		...lspDiagnosticsClientExtension(),
		editorExtension: lspDiagnosticsUiExtension(includeGutter),
	};
}

export default lspDiagnosticsExtension;

export function clearDiagnosticsEffect(): StateEffect<LspDiagnostic[]> {
	return setPublishedDiagnostics.of([]);
}

export function getLspDiagnostics(state: EditorState | null): LspDiagnostic[] {
	if (!state || typeof state.field !== "function") return [];
	try {
		const stored = state.field(lspPublishedDiagnostics, false);
		if (!stored || !Array.isArray(stored)) return [];
		return stored.map((diagnostic) => ({ ...diagnostic }));
	} catch (_) {
		return [];
	}
}

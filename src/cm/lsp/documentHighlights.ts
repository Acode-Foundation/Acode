/**
 * LSP Document Highlights Extension for CodeMirror
 *
 * Highlights all occurrences of the word under cursor using LSP documentHighlight request.
 * Supports read/write distinction for variables (e.g., assignments vs. references).
 */

import type { LSPClient, LSPClientExtension } from "@codemirror/lsp-client";
import { LSPPlugin } from "@codemirror/lsp-client";
import type { Extension, Range } from "@codemirror/state";
import { RangeSet, StateEffect, StateField } from "@codemirror/state";
import {
	Decoration,
	type DecorationSet,
	EditorView,
	ViewPlugin,
	type ViewUpdate,
} from "@codemirror/view";
import type {
	DocumentHighlight,
	DocumentHighlightKind,
	Position,
} from "vscode-languageserver-types";
import type { LSPPluginAPI } from "./types";

/**
 * LSP DocumentHighlightKind
 * 1 = Text (general highlight)
 * 2 = Read (read access of a symbol)
 * 3 = Write (write access of a symbol)
 */

interface DocumentHighlightParams {
	textDocument: { uri: string };
	position: Position;
}

interface ProcessedHighlight {
	from: number;
	to: number;
	kind: DocumentHighlightKind;
}

export interface DocumentHighlightsConfig {
	/** Whether to enable document highlights. Default: true */
	enabled?: boolean;
	/** Debounce delay in milliseconds. Default: 150ms */
	debounceMs?: number;
	/** Show different colors for read vs write. Default: true */
	distinguishReadWrite?: boolean;
}

// DocumentHighlightKind constants
const HIGHLIGHT_TEXT = 1 as const;
const HIGHLIGHT_READ = 2 as const;
const HIGHLIGHT_WRITE = 3 as const;

const setHighlights = StateEffect.define<ProcessedHighlight[]>();

const highlightsField = StateField.define<ProcessedHighlight[]>({
	create: () => [],
	update(highlights, tr) {
		for (const e of tr.effects) {
			if (e.is(setHighlights)) return e.value;
		}
		// Clear highlights on doc change (will be refreshed by plugin)
		if (tr.docChanged) return [];
		return highlights;
	},
});

const textMark = Decoration.mark({ class: "cm-lsp-highlight" });
const readMark = Decoration.mark({
	class: "cm-lsp-highlight cm-lsp-highlight-read",
});
const writeMark = Decoration.mark({
	class: "cm-lsp-highlight cm-lsp-highlight-write",
});

function getMarkForKind(
	kind: DocumentHighlightKind,
	distinguishReadWrite: boolean,
): typeof textMark {
	if (!distinguishReadWrite) return textMark;
	switch (kind) {
		case HIGHLIGHT_READ:
			return readMark;
		case HIGHLIGHT_WRITE:
			return writeMark;
		default:
			return textMark;
	}
}

function buildDecos(
	highlights: ProcessedHighlight[],
	docLen: number,
	distinguishReadWrite: boolean,
): DecorationSet {
	if (!highlights.length) return Decoration.none;

	const decos: Range<Decoration>[] = [];
	for (const h of highlights) {
		if (h.from < 0 || h.to > docLen || h.from >= h.to) continue;
		decos.push(
			getMarkForKind(h.kind, distinguishReadWrite).range(h.from, h.to),
		);
	}
	// Sort by position for RangeSet
	decos.sort((a, b) => a.from - b.from || a.to - b.to);
	return RangeSet.of(decos);
}

function createPlugin(config: DocumentHighlightsConfig) {
	const delay = config.debounceMs ?? 150;
	const distinguishReadWrite = config.distinguishReadWrite !== false;

	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet = Decoration.none;
			timer: ReturnType<typeof setTimeout> | null = null;
			reqId = 0;
			lastPos = -1;

			constructor(private view: EditorView) {}

			update(update: ViewUpdate): void {
				// Rebuild decorations if highlights changed
				if (
					update.transactions.some((t) =>
						t.effects.some((e) => e.is(setHighlights)),
					)
				) {
					this.decorations = buildDecos(
						update.state.field(highlightsField, false) ?? [],
						update.state.doc.length,
						distinguishReadWrite,
					);
				}

				// Schedule fetch on selection or doc change
				if (update.docChanged || update.selectionSet) {
					this.schedule();
				}
			}

			schedule(): void {
				if (this.timer) clearTimeout(this.timer);
				this.timer = setTimeout(() => {
					this.timer = null;
					this.fetch();
				}, delay);
			}

			async fetch(): Promise<void> {
				const lsp = LSPPlugin.get(this.view) as LSPPluginAPI | null;
				if (!lsp?.client.connected) {
					this.clear();
					return;
				}

				const caps = lsp.client.serverCapabilities;
				if (!caps?.documentHighlightProvider) {
					this.clear();
					return;
				}

				// Get current cursor position
				const selection = this.view.state.selection.main;
				const pos = selection.head;

				// Skip if position hasn't changed (and no doc changes)
				if (pos === this.lastPos) return;
				this.lastPos = pos;

				// Don't highlight if there's a selection range
				if (!selection.empty) {
					this.clear();
					return;
				}

				lsp.client.sync();
				const id = ++this.reqId;

				try {
					const highlights = await lsp.client.request<
						DocumentHighlightParams,
						DocumentHighlight[] | null
					>("textDocument/documentHighlight", {
						textDocument: { uri: lsp.uri },
						position: lsp.toPosition(pos),
					});

					// Stale request check
					if (id !== this.reqId) return;

					if (!highlights || !highlights.length) {
						this.clear();
						return;
					}

					const processed = this.process(lsp, highlights);
					this.view.dispatch({ effects: setHighlights.of(processed) });
				} catch {
					// Non-critical - silently ignore
					this.clear();
				}
			}

			process(
				lsp: LSPPluginAPI,
				highlights: DocumentHighlight[],
			): ProcessedHighlight[] {
				const result: ProcessedHighlight[] = [];
				const doc = this.view.state.doc;

				for (const h of highlights) {
					let from: number;
					let to: number;
					try {
						from = lsp.fromPosition(h.range.start, lsp.syncedDoc);
						to = lsp.fromPosition(h.range.end, lsp.syncedDoc);

						// Map through unsynced changes
						const mappedFrom = lsp.unsyncedChanges.mapPos(from);
						const mappedTo = lsp.unsyncedChanges.mapPos(to);
						if (mappedFrom === null || mappedTo === null) continue;
						from = mappedFrom;
						to = mappedTo;
					} catch {
						continue;
					}

					if (from < 0 || to > doc.length || from >= to) continue;

					result.push({
						from,
						to,
						kind: h.kind ?? HIGHLIGHT_TEXT,
					});
				}

				return result.sort((a, b) => a.from - b.from);
			}

			clear(): void {
				const current = this.view.state.field(highlightsField, false);
				if (current && current.length > 0) {
					this.view.dispatch({ effects: setHighlights.of([]) });
				}
			}

			destroy(): void {
				if (this.timer) clearTimeout(this.timer);
			}
		},
		{ decorations: (v) => v.decorations },
	);
}

const styles = EditorView.baseTheme({
	// Base highlight style (for text/unspecified kind)
	".cm-lsp-highlight": {
		backgroundColor: "rgba(150, 150, 150, 0.2)",
		borderRadius: "2px",
	},
	// Read access highlight (slightly lighter)
	"&light .cm-lsp-highlight-read": {
		backgroundColor: "rgba(121, 196, 142, 0.25)",
	},
	"&dark .cm-lsp-highlight-read": {
		backgroundColor: "rgba(121, 196, 142, 0.15)",
	},
	// Write access highlight (more prominent)
	"&light .cm-lsp-highlight-write": {
		backgroundColor: "rgba(196, 121, 121, 0.25)",
	},
	"&dark .cm-lsp-highlight-write": {
		backgroundColor: "rgba(196, 121, 121, 0.15)",
	},
});

/**
 * Client extension that adds documentHighlight capabilities to the LSP client.
 */
export function documentHighlightsClientExtension(): LSPClientExtension {
	return {
		clientCapabilities: {
			textDocument: {
				documentHighlight: {
					dynamicRegistration: true,
				},
			},
		},
	};
}

/**
 * Editor extension that handles document highlights display.
 */
export function documentHighlightsEditorExtension(
	config: DocumentHighlightsConfig = {},
): Extension {
	if (config.enabled === false) return [];
	return [highlightsField, createPlugin(config), styles];
}

/**
 * Combined extension for document highlights.
 */
export function documentHighlightsExtension(
	config: DocumentHighlightsConfig = {},
): LSPClientExtension & { editorExtension: Extension } {
	return {
		...documentHighlightsClientExtension(),
		editorExtension: documentHighlightsEditorExtension(config),
	};
}

export default documentHighlightsExtension;

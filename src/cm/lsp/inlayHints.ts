/**
 * LSP Inlay Hints Extension for CodeMirror
 *
 * Provides inline hints (type annotations, parameter names, etc.) from language servers.
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
	WidgetType,
} from "@codemirror/view";
import type {
	InlayHint,
	InlayHintLabelPart,
	Position,
} from "vscode-languageserver-types";
import type { LSPPluginAPI } from "./types";

// ============================================================================
// Types
// ============================================================================

interface InlayHintParams {
	textDocument: { uri: string };
	range: { start: Position; end: Position };
}

interface ProcessedHint {
	pos: number;
	label: string;
	paddingLeft?: boolean;
	paddingRight?: boolean;
	tooltip?: string;
}

export interface InlayHintsConfig {
	enabled?: boolean;
	debounceMs?: number;
	showTypes?: boolean;
	showParameters?: boolean;
	maxHints?: number;
}

// LSP InlayHintKind constants
const TYPE_HINT = 1;
const PARAM_HINT = 2;

// ============================================================================
// State
// ============================================================================

const setHints = StateEffect.define<ProcessedHint[]>();

const hintsField = StateField.define<ProcessedHint[]>({
	create: () => [],
	update(hints, tr) {
		for (const e of tr.effects) {
			if (e.is(setHints)) return e.value;
		}
		return hints;
	},
});

// ============================================================================
// Widget
// ============================================================================

class HintWidget extends WidgetType {
	constructor(
		readonly label: string,
		readonly padLeft: boolean,
		readonly padRight: boolean,
		readonly tooltip: string | undefined,
	) {
		super();
	}

	eq(other: HintWidget): boolean {
		return (
			this.label === other.label &&
			this.padLeft === other.padLeft &&
			this.padRight === other.padRight
		);
	}

	toDOM(): HTMLSpanElement {
		const el = document.createElement("span");
		el.className = `cm-inlay-hint${this.padLeft ? " cm-inlay-hint-pl" : ""}${this.padRight ? " cm-inlay-hint-pr" : ""}`;
		el.textContent = this.label;
		if (this.tooltip) el.title = this.tooltip;
		return el;
	}

	ignoreEvent(): boolean {
		return true;
	}
}

// ============================================================================
// Decorations
// ============================================================================

function buildDecos(hints: ProcessedHint[], docLen: number): DecorationSet {
	if (!hints.length) return Decoration.none;

	const decos: Range<Decoration>[] = [];
	for (const h of hints) {
		if (h.pos < 0 || h.pos > docLen) continue;
		decos.push(
			Decoration.widget({
				widget: new HintWidget(
					h.label,
					h.paddingLeft ?? false,
					h.paddingRight ?? false,
					h.tooltip,
				),
				side: 1,
			}).range(h.pos),
		);
	}
	return RangeSet.of(decos, true);
}

// ============================================================================
// Plugin
// ============================================================================

function createPlugin(config: InlayHintsConfig) {
	const delay = config.debounceMs ?? 200;
	const max = config.maxHints ?? 500;
	const showTypes = config.showTypes !== false;
	const showParams = config.showParameters !== false;

	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet = Decoration.none;
			timer: ReturnType<typeof setTimeout> | null = null;
			reqId = 0;

			constructor(private view: EditorView) {
				this.fetch();
			}

			update(update: ViewUpdate): void {
				if (
					update.transactions.some((t) => t.effects.some((e) => e.is(setHints)))
				) {
					this.decorations = buildDecos(
						update.state.field(hintsField, false) ?? [],
						update.state.doc.length,
					);
				}
				if (update.docChanged || update.viewportChanged) {
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
				if (!lsp?.client.connected) return;

				const caps = lsp.client.serverCapabilities;
				if (!caps?.inlayHintProvider) return;

				lsp.client.sync();
				const id = ++this.reqId;
				const doc = this.view.state.doc;

				// Visible range with buffer
				const { from, to } = this.view.viewport;
				const buf = 20;
				const startLn = Math.max(1, doc.lineAt(Math.max(0, from)).number - buf);
				const endLn = Math.min(
					doc.lines,
					doc.lineAt(Math.min(doc.length, to)).number + buf,
				);

				try {
					const hints = await lsp.client.request<
						InlayHintParams,
						InlayHint[] | null
					>("textDocument/inlayHint", {
						textDocument: { uri: lsp.uri },
						range: {
							start: lsp.toPosition(doc.line(startLn).from),
							end: lsp.toPosition(doc.line(endLn).to),
						},
					});

					if (id !== this.reqId) return;

					const processed = this.process(lsp, hints ?? [], doc.length);
					this.view.dispatch({ effects: setHints.of(processed) });
				} catch {
					// Non-critical - silently ignore
				}
			}

			process(
				lsp: LSPPluginAPI,
				hints: InlayHint[],
				docLen: number,
			): ProcessedHint[] {
				const result: ProcessedHint[] = [];

				for (const h of hints) {
					if (h.kind === TYPE_HINT && !showTypes) continue;
					if (h.kind === PARAM_HINT && !showParams) continue;

					let pos: number;
					try {
						pos = lsp.fromPosition(h.position, lsp.syncedDoc);
						const mapped = lsp.unsyncedChanges.mapPos(pos);
						if (mapped === null) continue;
						pos = mapped;
					} catch {
						continue;
					}

					if (pos < 0 || pos > docLen) continue;

					const label =
						typeof h.label === "string"
							? h.label
							: Array.isArray(h.label)
								? h.label.map((p: InlayHintLabelPart) => p.value).join("")
								: "";
					if (!label) continue;

					const tooltip =
						typeof h.tooltip === "string"
							? h.tooltip
							: h.tooltip &&
									typeof h.tooltip === "object" &&
									"value" in h.tooltip
								? (h.tooltip as { value: string }).value
								: undefined;

					result.push({
						pos,
						label,
						paddingLeft: h.paddingLeft,
						paddingRight: h.paddingRight,
						tooltip,
					});

					if (result.length >= max) break;
				}

				return result.sort((a, b) => a.pos - b.pos);
			}

			destroy(): void {
				if (this.timer) clearTimeout(this.timer);
			}
		},
		{ decorations: (v) => v.decorations },
	);
}

// ============================================================================
// Styles
// ============================================================================

const styles = EditorView.baseTheme({
	".cm-inlay-hint": {
		display: "inline-block",
		fontFamily: "inherit",
		fontSize: "0.9em",
		fontStyle: "italic",
		borderRadius: "3px",
		padding: "0 3px",
		margin: "0 2px",
		verticalAlign: "baseline",
		pointerEvents: "none",
	},
	"&light .cm-inlay-hint": {
		color: "#6a737d",
		backgroundColor: "rgba(27, 31, 35, 0.05)",
	},
	"&dark .cm-inlay-hint": {
		color: "#6a9955",
		backgroundColor: "rgba(255, 255, 255, 0.05)",
	},
	".cm-inlay-hint-pl": { marginLeft: "4px" },
	".cm-inlay-hint-pr": { marginRight: "4px" },
});

// ============================================================================
// Exports
// ============================================================================

export function inlayHintsClientExtension(): LSPClientExtension {
	return {
		clientCapabilities: {
			textDocument: {
				inlayHint: {
					dynamicRegistration: true,
					resolveSupport: {
						properties: [
							"tooltip",
							"textEdits",
							"label.tooltip",
							"label.location",
							"label.command",
						],
					},
				},
			},
		},
	};
}

export function inlayHintsEditorExtension(
	config: InlayHintsConfig = {},
): Extension {
	if (config.enabled === false) return [];
	return [hintsField, createPlugin(config), styles];
}

export function inlayHintsExtension(
	config: InlayHintsConfig = {},
): LSPClientExtension & { editorExtension: Extension } {
	return {
		...inlayHintsClientExtension(),
		editorExtension: inlayHintsEditorExtension(config),
	};
}

export default inlayHintsExtension;

import type { LSPClientExtension } from "@codemirror/lsp-client";
import { LSPPlugin } from "@codemirror/lsp-client";
import type { Extension, Range } from "@codemirror/state";
import { MapMode, StateEffect, StateField } from "@codemirror/state";
import {
	Decoration,
	type DecorationSet,
	EditorView,
	ViewPlugin,
	type ViewUpdate,
} from "@codemirror/view";
import appSettings from "lib/settings";
import type {
	Color,
	ColorInformation,
	ColorPresentation,
	Range as LspRange,
	TextEdit,
} from "vscode-languageserver-types";
import {
	clamp01,
	colorChipDecoration,
	colorChipTheme,
	cssToLspColor,
	detectColorFormat,
	findColorChip,
	getColorChipPayload,
	hasLspColorProvider,
	isViewEditable,
	lspColorToCss,
	lspColorToHex,
	openColorPicker,
	type ColorChipPayload,
} from "../colorChip";
import type { LSPPluginAPI } from "./types";

export interface DocumentColorsConfig {
	enabled?: boolean;
	debounceMs?: number;
	maxColors?: number;
	viewportBufferLines?: number;
	showPicker?: boolean;
}

export interface LspDocumentColor {
	from: number;
	to: number;
	color: Color;
	css: string;
}

interface DocumentColorParams {
	textDocument: { uri: string };
}

interface ColorPresentationParams {
	textDocument: { uri: string };
	color: Color;
	range: LspRange;
}

const DEFAULT_DEBOUNCE_MS = 150;
const DEFAULT_MAX_COLORS = 500;
const DEFAULT_VIEWPORT_BUFFER = 30;

const setColors = StateEffect.define<LspDocumentColor[]>();

/** LSP color ranges — used by regex colorView to skip covered spans. */
export const lspDocumentColorsField = StateField.define<LspDocumentColor[]>({
	create: () => [],
	update(colors, tr) {
		let next = colors;
		if (tr.docChanged && next.length) {
			const mapped: LspDocumentColor[] = [];
			for (const c of next) {
				const from = tr.changes.mapPos(c.from, 1);
				const to = tr.changes.mapPos(c.to, -1);
				if (from < to) mapped.push({ ...c, from, to });
			}
			next = mapped;
		}
		for (const e of tr.effects) {
			if (e.is(setColors)) return e.value;
		}
		return next;
	},
});

function pickPresentation(
	presentations: ColorPresentation[],
	originalText: string,
	pickedCss: string,
): ColorPresentation | null {
	if (!presentations.length) return null;

	const origFmt = detectColorFormat(originalText);
	const pickedFmt = detectColorFormat(pickedCss);

	const score = (p: ColorPresentation): number => {
		const label = p.label || "";
		const fmt = detectColorFormat(label);
		let s = 0;
		if (fmt === origFmt) s += 4;
		if (fmt === pickedFmt) s += 2;
		if (p.textEdit) s += 1;
		s += Math.max(0, 40 - label.length) / 100;
		return s;
	};

	let best = presentations[0];
	let bestScore = score(best);
	for (let i = 1; i < presentations.length; i++) {
		const p = presentations[i];
		const s = score(p);
		if (s > bestScore) {
			best = p;
			bestScore = s;
		}
	}
	return best;
}

export { hasLspColorProvider as hasColorProvider };

function viewportBounds(
	view: EditorView,
	bufferLines: number,
): { from: number; to: number } {
	const doc = view.state.doc;
	if (!doc.length) return { from: 0, to: 0 };
	const { from, to } = view.viewport;
	const startLine = doc.lineAt(Math.max(0, from));
	const endLine = doc.lineAt(Math.min(doc.length, to));
	const fromLine = Math.max(1, startLine.number - bufferLines);
	const toLine = Math.min(doc.lines, endLine.number + bufferLines);
	return {
		from: doc.line(fromLine).from,
		to: doc.line(toLine).to,
	};
}

function toChipPayload(c: LspDocumentColor): ColorChipPayload {
	return {
		from: c.from,
		to: c.to,
		css: c.css,
		pickerSeed: lspColorToHex(c.color),
		source: "lsp",
	};
}

function buildDecos(
	colors: readonly LspDocumentColor[],
	bounds: { from: number; to: number },
	docLen: number,
): DecorationSet {
	if (!colors.length || docLen <= 0) return Decoration.none;

	const decos: Range<Decoration>[] = [];
	for (const c of colors) {
		if (c.from < 0 || c.to > docLen || c.from >= c.to) continue;
		if (c.to < bounds.from || c.from > bounds.to) continue;
		decos.push(colorChipDecoration(toChipPayload(c)));
	}
	return Decoration.set(decos, true);
}

function mapLspRange(
	lsp: LSPPluginAPI,
	range: LspRange,
	docLen: number,
): { from: number; to: number } | null {
	let from: number;
	let to: number;
	try {
		const fromBase = lsp.fromPosition(range.start, lsp.syncedDoc);
		const toBase = lsp.fromPosition(range.end, lsp.syncedDoc);
		const fromMapped = lsp.unsyncedChanges.mapPos(
			fromBase,
			1,
			MapMode.TrackDel,
		);
		const toMapped = lsp.unsyncedChanges.mapPos(toBase, -1, MapMode.TrackDel);
		if (fromMapped == null || toMapped == null) return null;
		from = fromMapped;
		to = toMapped;
	} catch {
		return null;
	}
	if (from < 0 || to > docLen || from >= to) return null;
	return { from, to };
}

function toLspRange(lsp: LSPPluginAPI, from: number, to: number): LspRange {
	return {
		start: lsp.toPosition(from),
		end: lsp.toPosition(to),
	};
}

function applyTextEdits(
	lsp: LSPPluginAPI,
	view: EditorView,
	edits: TextEdit[],
): boolean {
	const changes: { from: number; to: number; insert: string }[] = [];
	for (const edit of edits) {
		if (!edit?.range) continue;
		const mapped = mapLspRange(lsp, edit.range, view.state.doc.length);
		if (!mapped) continue;
		const insert =
			typeof edit.newText === "string"
				? edit.newText.replace(/\r\n/g, "\n")
				: "";
		changes.push({ from: mapped.from, to: mapped.to, insert });
	}
	if (!changes.length) return false;
	changes.sort((a, b) => a.from - b.from || a.to - b.to);
	view.dispatch({ changes });
	return true;
}

const MAX_CONNECT_RETRIES = 30;
const MAX_CAP_RETRIES = 30;

/** True when a transaction replaced the LSP color list (not just mapped positions). */
export function didReplaceLspDocumentColors(update: ViewUpdate): boolean {
	return update.transactions.some((t) =>
		t.effects.some((e) => e.is(setColors)),
	);
}

function createPlugin(config: DocumentColorsConfig) {
	const delay = config.debounceMs ?? DEFAULT_DEBOUNCE_MS;
	const maxColors = config.maxColors ?? DEFAULT_MAX_COLORS;
	const bufferLines = config.viewportBufferLines ?? DEFAULT_VIEWPORT_BUFFER;
	const showPicker = config.showPicker !== false;

	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet = Decoration.none;
			timer: ReturnType<typeof setTimeout> | null = null;
			reqId = 0;
			providerKnown = false;
			hasProvider = false;
			connectRetries = 0;
			capRetries = 0;

			constructor(private view: EditorView) {
				this.schedule(true);
			}

			update(update: ViewUpdate): void {
				const colors = update.state.field(lspDocumentColorsField, false) ?? [];

				if (
					update.viewportChanged ||
					update.docChanged ||
					didReplaceLspDocumentColors(update)
				) {
					this.decorations = buildDecos(
						colors,
						viewportBounds(update.view, bufferLines),
						update.state.doc.length,
					);
				}

				if (update.docChanged) {
					this.schedule(false);
				}
			}

			schedule(immediate: boolean): void {
				if (this.timer) clearTimeout(this.timer);
				if (immediate) {
					this.timer = null;
					void this.fetch();
					return;
				}
				this.timer = setTimeout(() => {
					this.timer = null;
					void this.fetch();
				}, delay);
			}

			async fetch(): Promise<void> {
				if (appSettings.value?.colorPreview === false) {
					this.clearColors();
					return;
				}

				const lsp = LSPPlugin.get(this.view) as LSPPluginAPI | null;
				if (!lsp?.client.connected) {
					if (this.hasProvider || this.providerKnown) {
						this.hasProvider = false;
						this.providerKnown = false;
						this.clearColors();
					}
					this.capRetries = 0;
					if (this.connectRetries < MAX_CONNECT_RETRIES) {
						this.connectRetries++;
						this.schedule(false);
					}
					return;
				}
				this.connectRetries = 0;

				const caps = lsp.client.serverCapabilities as
					| { colorProvider?: boolean | object }
					| null
					| undefined;

				if (!caps) {
					if (this.capRetries < MAX_CAP_RETRIES) {
						this.capRetries++;
						this.schedule(false);
					}
					return;
				}
				this.capRetries = 0;

				const provider = !!caps.colorProvider;
				this.providerKnown = true;
				if (!provider) {
					if (this.hasProvider) {
						this.hasProvider = false;
						this.clearColors();
					}
					return;
				}
				this.hasProvider = true;

				lsp.client.sync();
				const id = ++this.reqId;
				const docLen = this.view.state.doc.length;

				try {
					const result = await lsp.client.request<
						DocumentColorParams,
						ColorInformation[] | null
					>("textDocument/documentColor", {
						textDocument: { uri: lsp.uri },
					});

					if (id !== this.reqId) return;

					const stored = this.process(lsp, result ?? [], docLen);
					this.view.dispatch({ effects: setColors.of(stored) });
				} catch {
					/* keep previous chips */
				}
			}

			process(
				lsp: LSPPluginAPI,
				infos: ColorInformation[],
				docLen: number,
			): LspDocumentColor[] {
				const out: LspDocumentColor[] = [];
				for (const info of infos) {
					if (!info?.range || !info.color) continue;
					const mapped = mapLspRange(lsp, info.range, docLen);
					if (!mapped) continue;

					const color: Color = {
						red: clamp01(info.color.red),
						green: clamp01(info.color.green),
						blue: clamp01(info.color.blue),
						alpha: clamp01(info.color.alpha ?? 1),
					};

					out.push({
						from: mapped.from,
						to: mapped.to,
						color,
						css: lspColorToCss(color),
					});

					if (out.length >= maxColors) break;
				}
				return out.sort((a, b) => a.from - b.from || a.to - b.to);
			}

			clearColors(): void {
				const current =
					this.view.state.field(lspDocumentColorsField, false) ?? [];
				if (current.length) {
					this.view.dispatch({ effects: setColors.of([]) });
				}
			}

			destroy(): void {
				if (this.timer) clearTimeout(this.timer);
				this.reqId++;
			}
		},
		{
			decorations: (v) => v.decorations,
			eventHandlers: {
				click(e: MouseEvent, view: EditorView): boolean {
					if (!showPicker) return false;

					const chip = findColorChip(e.target);
					if (!chip) return false;

					const payload = getColorChipPayload(chip);
					if (!payload || payload.source !== "lsp") return false;
					if (!isViewEditable(view)) return true;

					void handleColorPick(view, payload);
					return true;
				},
			},
		},
	);
}

async function handleColorPick(
	view: EditorView,
	payload: ColorChipPayload,
): Promise<void> {
	const lsp = LSPPlugin.get(view) as LSPPluginAPI | null;
	if (!lsp?.client.connected) return;

	const doc = view.state.doc;
	const stillValid =
		payload.from >= 0 && payload.to <= doc.length && payload.from < payload.to;
	const currentText = stillValid
		? doc.sliceString(payload.from, payload.to)
		: payload.css;
	const seed = payload.pickerSeed || currentText || payload.css || "#ffffff";

	const picked = await openColorPicker(seed);
	if (!picked) return;

	const lsp2 = LSPPlugin.get(view) as LSPPluginAPI | null;
	if (!lsp2?.client.connected) return;

	const live = findLiveColor(view, payload, currentText);
	if (!live) return;

	const lspColor = cssToLspColor(picked);
	if (!lspColor) {
		view.dispatch({
			changes: { from: live.from, to: live.to, insert: picked },
		});
		return;
	}

	try {
		lsp2.client.sync();
		const range = toLspRange(lsp2, live.from, live.to);
		const presentations = await lsp2.client.request<
			ColorPresentationParams,
			ColorPresentation[] | null
		>("textDocument/colorPresentation", {
			textDocument: { uri: lsp2.uri },
			color: lspColor,
			range,
		});

		const chosen = pickPresentation(presentations ?? [], live.text, picked);
		if (chosen?.textEdit) {
			const edits: TextEdit[] = [chosen.textEdit];
			if (chosen.additionalTextEdits?.length) {
				edits.push(...chosen.additionalTextEdits);
			}
			if (applyTextEdits(lsp2, view, edits)) return;
		}

		const insert = chosen?.label || picked;
		const after = findLiveColor(view, live, live.text);
		if (!after) return;
		view.dispatch({
			changes: { from: after.from, to: after.to, insert },
		});
	} catch {
		const after = findLiveColor(view, live, live.text);
		if (!after) return;
		view.dispatch({
			changes: { from: after.from, to: after.to, insert: picked },
		});
	}
}

function findLiveColor(
	view: EditorView,
	hint: { from: number; to: number },
	expectedText?: string,
): { from: number; to: number; text: string } | null {
	const colors = view.state.field(lspDocumentColorsField, false) ?? [];
	const doc = view.state.doc;

	const match =
		colors.find((c) => c.from === hint.from && c.to === hint.to) ??
		colors.find((c) => c.from <= hint.to && c.to >= hint.from) ??
		null;

	const from = match?.from ?? hint.from;
	const to = match?.to ?? hint.to;
	if (from < 0 || to > doc.length || from >= to) return null;

	const text = doc.sliceString(from, to);
	if (expectedText != null && text !== expectedText) return null;
	return { from, to, text };
}

export function documentColorsClientExtension(): LSPClientExtension {
	return {
		clientCapabilities: {
			textDocument: {
				colorProvider: {
					dynamicRegistration: true,
				},
			},
		},
	};
}

export function documentColorsEditorExtension(
	config: DocumentColorsConfig = {},
): Extension {
	if (config.enabled === false) return [];
	return [lspDocumentColorsField, createPlugin(config), colorChipTheme];
}

export function documentColorsExtension(
	config: DocumentColorsConfig = {},
): LSPClientExtension & { editorExtension: Extension } {
	return {
		...documentColorsClientExtension(),
		editorExtension: documentColorsEditorExtension(config),
	};
}

export { cssToLspColor, lspColorToCss, lspColorToHex };

export default documentColorsExtension;

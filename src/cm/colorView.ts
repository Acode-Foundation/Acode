import type { Range, Text } from "@codemirror/state";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import { Decoration, EditorView, ViewPlugin } from "@codemirror/view";
import color from "utils/color";
import { colorRegex, isValidColor } from "utils/color/regex";
import {
	COLOR_CHIP_CLASS,
	colorChipDecoration,
	colorChipTheme,
	findColorChip,
	getColorChipPayload,
	isViewEditable,
	openColorPicker,
	type ColorChipPayload,
} from "./colorChip";
import { lspDocumentColorsField } from "./lsp/documentColors";

interface DocRange {
	from: number;
	to: number;
}

const RGBG = new RegExp(colorRegex.anyGlobal);

const MAX_SCAN_CHARS = 20000;
const MAX_COLOR_CHIPS = 150;

const disallowedBoundaryBefore = new Set(["-", ".", "/", "#"]);
const disallowedBoundaryAfter = new Set(["-", ".", "/"]);
const ignoredLeadingWords = new Set(["url"]);

function isWhitespace(char: string): boolean {
	return (
		char === " " ||
		char === "\t" ||
		char === "\n" ||
		char === "\r" ||
		char === "\f"
	);
}

function isAlpha(char: string): boolean {
	if (!char) return false;
	const code = char.charCodeAt(0);
	return (
		(code >= 65 && code <= 90) ||
		(code >= 97 && code <= 122)
	);
}

function charAt(doc: Text, index: number): string {
	if (index < 0 || index >= doc.length) return "";
	return doc.sliceString(index, index + 1);
}

function findPrevNonWhitespace(doc: Text, index: number): number {
	for (let i = index - 1; i >= 0; i--) {
		if (!isWhitespace(charAt(doc, i))) return i;
	}
	return -1;
}

function findNextNonWhitespace(doc: Text, index: number): number {
	for (let i = index; i < doc.length; i++) {
		if (!isWhitespace(charAt(doc, i))) return i;
	}
	return doc.length;
}

function readWordBefore(doc: Text, index: number): string {
	let pos = index;
	while (pos >= 0 && isWhitespace(charAt(doc, pos))) pos--;
	if (pos < 0) return "";
	if (charAt(doc, pos) === "(") {
		pos--;
	}
	while (pos >= 0 && isWhitespace(charAt(doc, pos))) pos--;
	const end = pos;
	while (pos >= 0 && isAlpha(charAt(doc, pos))) pos--;
	const start = pos + 1;
	if (end < start) return "";
	return doc.sliceString(start, end + 1).toLowerCase();
}

function shouldRenderColor(doc: Text, start: number, end: number): boolean {
	const immediatePrev = charAt(doc, start - 1);
	if (disallowedBoundaryBefore.has(immediatePrev)) return false;

	const immediateNext = charAt(doc, end);
	if (disallowedBoundaryAfter.has(immediateNext)) return false;

	const prevNonWhitespaceIndex = findPrevNonWhitespace(doc, start);
	if (prevNonWhitespaceIndex !== -1) {
		const prevNonWhitespaceChar = charAt(doc, prevNonWhitespaceIndex);
		if (disallowedBoundaryBefore.has(prevNonWhitespaceChar)) return false;
		const prevWord = readWordBefore(doc, prevNonWhitespaceIndex);
		if (ignoredLeadingWords.has(prevWord)) return false;
	}

	const nextNonWhitespaceIndex = findNextNonWhitespace(doc, end);
	if (nextNonWhitespaceIndex < doc.length) {
		const nextNonWhitespaceChar = charAt(doc, nextNonWhitespaceIndex);
		if (disallowedBoundaryAfter.has(nextNonWhitespaceChar)) return false;
	}

	return true;
}

function normalizeRanges(ranges: readonly DocRange[]): DocRange[] {
	if (!ranges.length) return [];
	const sorted = [...ranges]
		.map(({ from, to }) => {
			const rangeFrom = Math.max(0, from);
			return { from: rangeFrom, to: Math.max(rangeFrom, to) };
		})
		.sort((a, b) => a.from - b.from || a.to - b.to);
	const merged: DocRange[] = [];

	for (const range of sorted) {
		const last = merged[merged.length - 1];
		if (last && range.from <= last.to) {
			last.to = Math.max(last.to, range.to);
			continue;
		}
		merged.push(range);
	}

	return merged;
}

function mapRanges(
	ranges: readonly DocRange[],
	changes: ViewUpdate["changes"],
): DocRange[] {
	return normalizeRanges(
		ranges.map(({ from, to }) => ({
			from: changes.mapPos(from, -1),
			to: changes.mapPos(to, 1),
		})),
	);
}

function expandRangeToLines(doc: Text, from: number, to: number): DocRange {
	if (doc.length === 0) return { from: 0, to: 0 };
	const rangeFrom = Math.max(0, Math.min(doc.length, from));
	const rangeTo = Math.max(rangeFrom, Math.min(doc.length, to));
	const startLine = doc.lineAt(rangeFrom);
	const endLine = doc.lineAt(rangeTo);
	return { from: startLine.from, to: endLine.to };
}

function intersectsRange(from: number, to: number, range: DocRange): boolean {
	if (from === to) return from >= range.from && from <= range.to;
	return from < range.to && to > range.from;
}

function intersectsRanges(
	from: number,
	to: number,
	ranges: readonly DocRange[],
): boolean {
	return ranges.some((range) => intersectsRange(from, to, range));
}

function intersectRanges(
	ranges: readonly DocRange[],
	bounds: readonly DocRange[],
): DocRange[] {
	const intersections: DocRange[] = [];
	for (const range of ranges) {
		for (const bound of bounds) {
			const from = Math.max(range.from, bound.from);
			const to = Math.min(range.to, bound.to);
			if (from <= to) intersections.push({ from, to });
		}
	}
	return normalizeRanges(intersections);
}

function subtractRanges(
	ranges: readonly DocRange[],
	coveredRanges: readonly DocRange[],
): DocRange[] {
	const result: DocRange[] = [];
	const covered = normalizeRanges(coveredRanges);

	for (const range of normalizeRanges(ranges)) {
		let from = range.from;
		for (const cover of covered) {
			if (cover.to <= from) continue;
			if (cover.from >= range.to) break;
			if (cover.from > from) {
				result.push({ from, to: Math.min(cover.from, range.to) });
			}
			from = Math.max(from, cover.to);
			if (from >= range.to) break;
		}
		if (from < range.to) result.push({ from, to: range.to });
	}

	return result;
}

function getLspCoveredRanges(view: EditorView): DocRange[] {
	const colors = view.state.field(lspDocumentColorsField, false);
	if (!colors?.length) return [];
	return colors.map((c) => ({ from: c.from, to: c.to }));
}

function colorRanges(
	view: EditorView,
	ranges: readonly DocRange[],
): Range<Decoration>[] {
	const deco: Range<Decoration>[] = [];
	const doc = view.state.doc;
	const lspCovered = getLspCoveredRanges(view);
	let scannedChars = 0;

	for (const { from, to } of ranges) {
		if (deco.length >= MAX_COLOR_CHIPS || scannedChars >= MAX_SCAN_CHARS) break;
		const scanTo = Math.min(to, from + (MAX_SCAN_CHARS - scannedChars));
		if (scanTo <= from) continue;
		const text = doc.sliceString(from, scanTo);
		scannedChars += text.length;
		RGBG.lastIndex = 0;
		for (let m: RegExpExecArray | null; (m = RGBG.exec(text)); ) {
			if (deco.length >= MAX_COLOR_CHIPS) break;
			const raw = m[2];
			const start = from + m.index + m[1].length;
			const end = start + raw.length;
			// Skip spans already covered by LSP documentColor chips
			if (lspCovered.length && intersectsRanges(start, end, lspCovered)) {
				continue;
			}
			if (!shouldRenderColor(doc, start, end)) continue;
			const c = color(raw);
			const colorHex = c.hex.toString(false);
			deco.push(
				colorChipDecoration({
					from: start,
					to: end,
					css: raw,
					pickerSeed: colorHex,
					source: "regex",
				}),
			);
		}
	}

	return deco;
}

class ColorViewPlugin {
	decorations: DecorationSet;
	visibleRanges: DocRange[];
	flushTimer = 0;
	pendingView: EditorView | null = null;
	pendingDirtyRanges: DocRange[] = [];

	constructor(view: EditorView) {
		this.decorations = Decoration.none;
		this.visibleRanges = normalizeRanges(view.visibleRanges);
		this.scheduleVisibleRanges(view);
	}

	update(update: ViewUpdate): void {
		const lspChanged =
			update.startState.field(lspDocumentColorsField, false) !==
			update.state.field(lspDocumentColorsField, false);

		if (update.docChanged || update.viewportChanged || update.geometryChanged) {
			this.scheduleDecorations(update);
		}

		// Rescan when LSP colors arrive/change so regex fills gaps / drops overlaps
		if (lspChanged) {
			this.pendingView = update.view;
			this.pendingDirtyRanges = normalizeRanges([
				...this.pendingDirtyRanges,
				...update.view.visibleRanges,
			]);
			this.visibleRanges = normalizeRanges(update.view.visibleRanges);
			this.scheduleFlush();
		}
	}

	scheduleVisibleRanges(view: EditorView): void {
		this.pendingView = view;
		this.pendingDirtyRanges = normalizeRanges([
			...this.pendingDirtyRanges,
			...view.visibleRanges,
		]);
		this.scheduleFlush();
	}

	scheduleDecorations(update: ViewUpdate): void {
		const view = update.view;
		const doc = view.state.doc;
		const visibleRanges = normalizeRanges(view.visibleRanges);
		const mappedPreviousVisible = update.docChanged
			? mapRanges(this.visibleRanges, update.changes)
			: this.visibleRanges;
		const dirtyRanges: DocRange[] = [];

		if (update.docChanged) {
			this.decorations = this.decorations.map(update.changes);
			update.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
				dirtyRanges.push(expandRangeToLines(doc, fromB, toB));
			});
		}

		if (update.viewportChanged || update.geometryChanged) {
			dirtyRanges.push(...subtractRanges(visibleRanges, mappedPreviousVisible));
		}

		this.pendingView = view;
		this.pendingDirtyRanges = normalizeRanges([
			...this.pendingDirtyRanges,
			...dirtyRanges,
		]);
		this.visibleRanges = visibleRanges;

		this.scheduleFlush();
	}

	scheduleFlush(): void {
		if (this.flushTimer) return;
		this.flushTimer = window.setTimeout(() => {
			this.flushTimer = 0;
			const pendingView = this.pendingView;
			const dirtyRanges = this.pendingDirtyRanges;
			this.pendingView = null;
			this.pendingDirtyRanges = [];
			if (!pendingView) return;
			this.flushDecorations(pendingView, dirtyRanges);
		}, 80);
	}

	flushDecorations(view: EditorView, dirtyRanges: readonly DocRange[]): void {
		const visibleRanges = normalizeRanges(view.visibleRanges);
		const dirtyVisibleRanges = intersectRanges(dirtyRanges, visibleRanges);
		const add = colorRanges(view, dirtyVisibleRanges);
		const lspCovered = getLspCoveredRanges(view);

		this.decorations = this.decorations.update({
			filter: (from, to) =>
				intersectsRanges(from, to, visibleRanges) &&
				!intersectsRanges(from, to, dirtyVisibleRanges) &&
				// Drop leftover regex chips that LSP now covers
				!(lspCovered.length && intersectsRanges(from, to, lspCovered)),
			add,
			sort: true,
		});
		this.visibleRanges = visibleRanges;
	}

	destroy(): void {
		if (this.flushTimer) {
			window.clearTimeout(this.flushTimer);
			this.flushTimer = 0;
		}
		this.pendingView = null;
		this.pendingDirtyRanges = [];
		this.visibleRanges = [];
	}
}

async function handleRegexColorPick(
	view: EditorView,
	payload: ColorChipPayload,
): Promise<void> {
	const atClick = view.state.doc.sliceString(payload.from, payload.to);
	if (atClick !== payload.css || !isValidColor(atClick)) return;

	const picked = await openColorPicker(payload.pickerSeed || payload.css);
	if (!picked) return;

	const current = view.state.doc.sliceString(payload.from, payload.to);
	if (current !== atClick || !isValidColor(current)) return;

	view.dispatch({
		changes: { from: payload.from, to: payload.to, insert: picked },
	});
}

export const colorView = (showPicker = true) => [
	colorChipTheme,
	ViewPlugin.fromClass(ColorViewPlugin, {
		decorations: (v) => v.decorations,
		eventHandlers: {
			click: (e: PointerEvent, view: EditorView): boolean => {
				const chip = findColorChip(e.target);
				if (!chip) return false;

				const payload = getColorChipPayload(chip);
				if (!payload || payload.source !== "regex") return false;

				if (!showPicker) return true;
				if (!isViewEditable(view)) return true;

				void handleRegexColorPick(view, payload);
				return true;
			},
		},
	}),
];

export default colorView;

export { COLOR_CHIP_CLASS };

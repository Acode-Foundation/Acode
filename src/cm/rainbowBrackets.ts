import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder } from "@codemirror/state";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import { Decoration, EditorView, ViewPlugin } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";

const DEFAULT_DARK_COLORS = [
	"#e5c07b",
	"#c678dd",
	"#56b6c2",
	"#61afef",
	"#98c379",
	"#d19a66",
];

const DEFAULT_LIGHT_COLORS = [
	"#795e26",
	"#af00db",
	"#005cc5",
	"#008000",
	"#b15c00",
	"#267f99",
];

const BLOCK_SIZE = 2048;
const MAX_BLOCK_CACHE_ENTRIES = 192;
const CONTEXT_SIGNATURE_DEPTH = 4;
const MIN_LOOK_BEHIND = 4000;
const MAX_LOOK_BEHIND = 24000;
const DEFAULT_EXACT_SCAN_LIMIT = 24000;

const SKIP_CONTEXTS = new Set([
	"String",
	"TemplateString",
	"Comment",
	"LineComment",
	"BlockComment",
	"RegExp",
]);

const CLOSING_TO_OPENING = {
	")": "(",
	"]": "[",
	"}": "{",
} as const;

type ClosingBracket = keyof typeof CLOSING_TO_OPENING;

export interface RainbowBracketThemeConfig {
	dark?: boolean;
	keyword?: string;
	type?: string;
	class?: string;
	function?: string;
	string?: string;
	number?: string;
	constant?: string;
	variable?: string;
	foreground?: string;
}

export interface RainbowBracketsOptions {
	colors?: readonly string[];
	exactScanLimit?: number;
	lookBehind?: number;
}

interface BracketInfo {
	char: string;
	colorIndex: number;
}

interface BracketToken {
	offset: number;
	char: string;
}

interface BlockCacheEntry {
	carrySkipChars: number;
	tokens: readonly BracketToken[];
}

function normalizeHexColor(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const color = value.trim().toLowerCase();
	if (/^#([\da-f]{3}|[\da-f]{6})$/.test(color)) return color;
	return null;
}

function alignToBlockStart(pos: number): number {
	return pos - (pos % BLOCK_SIZE);
}

function clampLookBehind(value: number | undefined): number {
	if (!Number.isFinite(value)) return MAX_LOOK_BEHIND;
	return Math.max(
		MIN_LOOK_BEHIND,
		Math.min(MAX_LOOK_BEHIND, Math.floor(value || 0)),
	);
}

function getScanStart(
	view: EditorView,
	lookBehind: number,
	exactScanLimit: number,
): number {
	const ranges = view.visibleRanges;
	if (!ranges.length) return 0;

	const firstVisibleFrom = ranges[0].from;
	const lastVisibleTo = ranges[ranges.length - 1].to;
	const docLength = view.state.doc.length;

	if (docLength <= exactScanLimit || firstVisibleFrom <= exactScanLimit) {
		return 0;
	}

	const visibleSpan = Math.max(1, lastVisibleTo - firstVisibleFrom);
	const dynamicLookBehind = Math.max(
		MIN_LOOK_BEHIND,
		Math.min(MAX_LOOK_BEHIND, visibleSpan * 3),
	);

	return Math.max(
		0,
		firstVisibleFrom - Math.max(lookBehind, dynamicLookBehind),
	);
}

function isBracketCode(code: number): boolean {
	return (
		code === 40 ||
		code === 41 ||
		code === 91 ||
		code === 93 ||
		code === 123 ||
		code === 125
	);
}

function isOpeningBracket(char: string): boolean {
	return char === "(" || char === "[" || char === "{";
}

function getSkipContextEnd(
	tree: ReturnType<typeof syntaxTree>,
	pos: number,
): number {
	let node: SyntaxNode | null = tree.resolveInner(pos, 1);

	while (node) {
		if (SKIP_CONTEXTS.has(node.name)) return node.to;
		node = node.parent;
	}

	return -1;
}

function getContextChainSignature(
	tree: ReturnType<typeof syntaxTree>,
	pos: number,
): string {
	if (tree.length <= 0) return "";

	const clampedPos = Math.max(0, Math.min(tree.length - 1, pos));
	let node: SyntaxNode | null = tree.resolveInner(clampedPos, 1);
	const parts: string[] = [];

	for (let depth = 0; node && depth < CONTEXT_SIGNATURE_DEPTH; depth++) {
		parts.push(node.name);
		node = node.parent;
	}

	return parts.join(">");
}

function getBlockContextSignature(
	tree: ReturnType<typeof syntaxTree>,
	blockStart: number,
	blockEnd: number,
): string {
	if (blockEnd <= blockStart) return "";
	const endPos = Math.max(blockStart, blockEnd - 1);
	return `${getContextChainSignature(tree, blockStart)}|${getContextChainSignature(tree, endPos)}`;
}

function getBlockCacheKey(
	blockText: string,
	initialSkipChars: number,
	contextSignature: string,
): string {
	return `${initialSkipChars}\u0000${contextSignature}\u0000${blockText}`;
}

function tokenizeBlock(
	tree: ReturnType<typeof syntaxTree>,
	blockText: string,
	blockStart: number,
	initialSkipChars: number,
): BlockCacheEntry {
	const tokens: BracketToken[] = [];
	let skipUntilOffset = Math.max(0, initialSkipChars);

	if (!blockText.length) {
		return { carrySkipChars: skipUntilOffset, tokens };
	}

	if (skipUntilOffset >= blockText.length) {
		return { carrySkipChars: skipUntilOffset - blockText.length, tokens };
	}

	for (let offset = 0; offset < blockText.length; offset++) {
		if (offset < skipUntilOffset) continue;

		const code = blockText.charCodeAt(offset);
		if (!isBracketCode(code)) continue;

		const pos = blockStart + offset;
		const skipContextEnd = getSkipContextEnd(tree, pos);
		if (skipContextEnd > pos) {
			skipUntilOffset = Math.max(skipUntilOffset, skipContextEnd - blockStart);
			continue;
		}

		tokens.push({ offset, char: blockText[offset] });
	}

	return {
		carrySkipChars: Math.max(0, skipUntilOffset - blockText.length),
		tokens,
	};
}

function isVisiblePosition(
	pos: number,
	ranges: readonly { from: number; to: number }[],
	cursor: { index: number },
): boolean {
	while (cursor.index < ranges.length && pos >= ranges[cursor.index].to) {
		cursor.index++;
	}

	const range = ranges[cursor.index];
	return !!range && pos >= range.from && pos < range.to;
}

function buildTheme(colors: readonly string[]) {
	const themeSpec: Record<string, { color: string }> = {};

	colors.forEach((color, index) => {
		const selector = `.cm-rainbowBracket-${index}`;
		themeSpec[selector] = { color: `${color} !important` };
		themeSpec[`${selector} span`] = { color: `${color} !important` };
	});

	return EditorView.baseTheme(themeSpec);
}

export function getRainbowBracketColors(
	themeConfig: RainbowBracketThemeConfig = {},
): string[] {
	const fallback = themeConfig.dark
		? DEFAULT_DARK_COLORS
		: DEFAULT_LIGHT_COLORS;
	const colors: string[] = [];
	const seen = new Set<string>();

	for (const candidate of [
		themeConfig.keyword,
		themeConfig.type,
		themeConfig.class,
		themeConfig.function,
		themeConfig.string,
		themeConfig.number,
		themeConfig.constant,
		themeConfig.variable,
		themeConfig.foreground,
	]) {
		const color = normalizeHexColor(candidate);
		if (!color || seen.has(color)) continue;
		seen.add(color);
		colors.push(color);
		if (colors.length === fallback.length) break;
	}

	if (colors.length < 4) {
		return [...fallback];
	}

	for (const fallbackColor of fallback) {
		if (colors.length === fallback.length) break;
		if (seen.has(fallbackColor)) continue;
		colors.push(fallbackColor);
	}

	return colors;
}

export function rainbowBrackets(options: RainbowBracketsOptions = {}) {
	const colors =
		options.colors != null && options.colors.length > 0
			? [...options.colors]
			: getRainbowBracketColors();
	const exactScanLimit = Math.max(
		MIN_LOOK_BEHIND,
		Math.floor(options.exactScanLimit || DEFAULT_EXACT_SCAN_LIMIT),
	);
	const lookBehind = clampLookBehind(options.lookBehind);
	const theme = buildTheme(colors);
	const marks = colors.map((_, index) =>
		Decoration.mark({ class: `cm-rainbowBracket-${index}` }),
	);

	const rainbowBracketsPlugin = ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;
			blockCache = new Map<string, BlockCacheEntry>();
			raf = 0;
			pendingView: EditorView | null = null;

			constructor(view: EditorView) {
				this.decorations = this.buildDecorations(view);
			}

			update(update: ViewUpdate) {
				if (!update.docChanged && !update.viewportChanged) return;
				this.scheduleBuild(update.view);
			}

			scheduleBuild(view: EditorView): void {
				this.pendingView = view;
				if (this.raf) return;
				// Bracket recoloring is cosmetic. Collapse bursts of edits/scroll
				// events into a single frame so large pastes don't block repeatedly.
				this.raf = requestAnimationFrame(() => {
					this.raf = 0;
					const pendingView = this.pendingView;
					this.pendingView = null;
					if (!pendingView) return;
					this.decorations = this.buildDecorations(pendingView);
				});
			}

			buildDecorations(view: EditorView): DecorationSet {
				const visibleRanges = view.visibleRanges;
				if (!visibleRanges.length || !marks.length) return Decoration.none;

				const tree = syntaxTree(view.state);
				const scanStart = alignToBlockStart(
					getScanStart(view, lookBehind, exactScanLimit),
				);
				const scanEnd = visibleRanges[visibleRanges.length - 1].to;
				const visibleCursor = { index: 0 };
				const openBrackets: BracketInfo[] = [];
				let carrySkipChars = 0;
				const builder = new RangeSetBuilder<Decoration>();

				for (
					let blockStart = scanStart;
					blockStart < scanEnd;
					blockStart += BLOCK_SIZE
				) {
					const blockEnd = Math.min(scanEnd, blockStart + BLOCK_SIZE);
					const blockText = view.state.doc.sliceString(blockStart, blockEnd);
					const cacheKey = getBlockCacheKey(
						blockText,
						carrySkipChars,
						getBlockContextSignature(tree, blockStart, blockEnd),
					);
					let cachedBlock = this.getCachedBlock(cacheKey);

					if (!cachedBlock) {
						cachedBlock = tokenizeBlock(
							tree,
							blockText,
							blockStart,
							carrySkipChars,
						);
						this.setCachedBlock(cacheKey, cachedBlock);
					}

					for (const token of cachedBlock.tokens) {
						const pos = blockStart + token.offset;

						if (isOpeningBracket(token.char)) {
							const colorIndex = openBrackets.length % marks.length;
							if (isVisiblePosition(pos, visibleRanges, visibleCursor)) {
								builder.add(pos, pos + 1, marks[colorIndex]);
							}
							openBrackets.push({ char: token.char, colorIndex });
							continue;
						}

						const matchingOpen =
							CLOSING_TO_OPENING[token.char as ClosingBracket];
						if (!matchingOpen) continue;

						for (let index = openBrackets.length - 1; index >= 0; index--) {
							if (openBrackets[index].char !== matchingOpen) continue;

							if (isVisiblePosition(pos, visibleRanges, visibleCursor)) {
								builder.add(
									pos,
									pos + 1,
									marks[openBrackets[index].colorIndex],
								);
							}

							openBrackets.length = index;
							break;
						}
					}

					carrySkipChars = cachedBlock.carrySkipChars;
				}

				return builder.finish();
			}

			getCachedBlock(key: string): BlockCacheEntry | null {
				const cached = this.blockCache.get(key);
				if (!cached) return null;
				this.blockCache.delete(key);
				this.blockCache.set(key, cached);
				return cached;
			}

			setCachedBlock(key: string, value: BlockCacheEntry): void {
				if (this.blockCache.has(key)) {
					this.blockCache.delete(key);
				}

				this.blockCache.set(key, value);
				if (this.blockCache.size <= MAX_BLOCK_CACHE_ENTRIES) return;

				const oldestKey = this.blockCache.keys().next().value;
				if (oldestKey !== undefined) {
					this.blockCache.delete(oldestKey);
				}
			}

			destroy(): void {
				if (this.raf) {
					cancelAnimationFrame(this.raf);
					this.raf = 0;
				}
				this.pendingView = null;
				this.blockCache.clear();
			}
		},
		{
			decorations: (value) => value.decorations,
		},
	);

	return [rainbowBracketsPlugin, theme];
}

export default rainbowBrackets;

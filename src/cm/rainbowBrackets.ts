import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder } from "@codemirror/state";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import { Decoration, EditorView, ViewPlugin } from "@codemirror/view";

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

const MIN_LOOK_BEHIND = 4000;
const MAX_LOOK_BEHIND = 24000;
const DEFAULT_EXACT_SCAN_LIMIT = 24000;

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

function normalizeHexColor(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const color = value.trim().toLowerCase();
	if (/^#([\da-f]{3}|[\da-f]{6})$/.test(color)) return color;
	return null;
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

function isOpeningBracket(char: string): boolean {
	return char === "(" || char === "[" || char === "{";
}

function isSkipContext(name: string): boolean {
	const lower = name.toLowerCase();
	return (
		lower.includes("string") ||
		lower.includes("comment") ||
		lower === "regexp" ||
		lower === "escape"
	);
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

			constructor(view: EditorView) {
				this.decorations = this.buildDecorations(view);
			}

			update(update: ViewUpdate) {
				if (!update.docChanged && !update.viewportChanged) return;
				this.decorations = this.buildDecorations(update.view);
			}

			buildDecorations(view: EditorView): DecorationSet {
				const visibleRanges = view.visibleRanges;
				if (!visibleRanges.length || !marks.length) return Decoration.none;

				const tree = syntaxTree(view.state);
				if (tree.length <= 0) return Decoration.none;

				const scanStart = getScanStart(view, lookBehind, exactScanLimit);
				const scanEnd = visibleRanges[visibleRanges.length - 1].to;
				const openBrackets: BracketInfo[] = [];
				const builder = new RangeSetBuilder<Decoration>();

				let visibleRangeIndex = 0;
				const isVisible = (pos: number): boolean => {
					while (
						visibleRangeIndex < visibleRanges.length &&
						pos >= visibleRanges[visibleRangeIndex].to
					) {
						visibleRangeIndex++;
					}
					const range = visibleRanges[visibleRangeIndex];
					return !!range && pos >= range.from && pos < range.to;
				};

				tree.iterate({
					from: scanStart,
					to: scanEnd,
					enter(node) {
						if (isSkipContext(node.name)) {
							return false;
						}

						const name = node.name;
						if (
							name === "(" ||
							name === "[" ||
							name === "{" ||
							name === ")" ||
							name === "]" ||
							name === "}"
						) {
							const pos = node.from;

							if (isOpeningBracket(name)) {
								const colorIndex = openBrackets.length % marks.length;
								if (isVisible(pos)) {
									builder.add(pos, pos + 1, marks[colorIndex]);
								}
								openBrackets.push({ char: name, colorIndex });
							} else {
								const matchingOpen = CLOSING_TO_OPENING[name as ClosingBracket];
								if (!matchingOpen) return;

								for (let index = openBrackets.length - 1; index >= 0; index--) {
									if (openBrackets[index].char !== matchingOpen) continue;

									if (isVisible(pos)) {
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
						}
					},
				});

				return builder.finish();
			}

			destroy(): void {}
		},
		{
			decorations: (value) => value.decorations,
		},
	);

	return [rainbowBracketsPlugin, theme];
}

export default rainbowBrackets;

import {
	type CanvasThemeSpec,
	CanvasView,
	type CanvasViewConfig,
	type FontSpec,
	parseColor,
	type TokenStyleSpec,
} from "@acode.app/canvas-view";
import { HighlightStyle } from "@codemirror/language";
import { oneDark } from "@codemirror/theme-one-dark";
import { tags as t } from "@lezer/highlight";
import { getRainbowBracketColors } from "cm/rainbowBrackets";
import { getThemeById, getThemeConfig, getThemeExtensions } from "cm/themes";

/**
 * Maps Acode's editor settings and themes to @acode.app/canvas-view options.
 *
 * The canvas renderer draws line numbers, fold markers, the active line,
 * indent guides, rainbow brackets, whitespace, wrapping and scroll room
 * itself, so editorManager leaves those CodeMirror extensions out of the
 * state and passes the options built here instead.
 */

export type CanvasDisplayOptions = Parameters<CanvasView["reconfigure"]>[0];

type Settings = Record<string, any>;

interface ThemeConfig {
	dark?: boolean;
	background?: string;
	foreground?: string;
	selection?: string;
	cursor?: string;
	activeLine?: string;
	lineNumber?: string;
	lineNumberActive?: string;
	gutterBorder?: string;
	matchingBracket?: string;
	selectionMatch?: string;
	[color: string]: unknown;
}

const SCROLL_PAST_END: Record<string, number> = {
	none: 0,
	small: 0.25,
	medium: 0.5,
	full: 1,
};

const SCROLL_SPEED: Record<string, CanvasViewConfig["scrollSpeed"]> = {
	SLOW: "slow",
	NORMAL: "normal",
	FAST: "fast",
	FAST_X2: "fastX2",
};

const GUTTER_MARKERS = ["shared", "columns", "overlay"] as const;

/** A finite number within [min, max], else the fallback. */
function clampSetting(
	value: unknown,
	min: number,
	max: number,
	fallback: number,
): number {
	const number = Number(value);
	if (value == null || value === "" || !Number.isFinite(number)) {
		return fallback;
	}
	return Math.min(Math.max(Math.round(number), min), max);
}

/**
 * Find the HighlightStyle a theme passes to `syntaxHighlighting()`, by
 * walking its extension tree (arrays, precedence wrappers, compartments,
 * `facet.of(value)` providers). Returns null for themes that compute their
 * highlighter (`themeType`) or don't have one.
 */
export function findHighlightStyle(
	extension: unknown,
	seen = new Set<unknown>(),
): HighlightStyle | null {
	if (!extension || typeof extension !== "object" || seen.has(extension)) {
		return null;
	}
	seen.add(extension);
	if (extension instanceof HighlightStyle) return extension;
	if (Array.isArray(extension)) {
		for (const item of extension) {
			const found = findHighlightStyle(item, seen);
			if (found) return found;
		}
		return null;
	}
	const node = extension as {
		value?: unknown;
		inner?: unknown;
		extension?: unknown;
	};
	return (
		findHighlightStyle(node.value, seen) ||
		findHighlightStyle(node.inner, seen) ||
		findHighlightStyle(node.extension, seen)
	);
}

/**
 * Editor surface colors a theme's own `EditorView.theme` rules set, for
 * the canvas renderer, which doesn't draw from CSS. Plugin themes are often
 * registered with only background, foreground and syntax colors in their
 * config, and style the active line, gutter and cursor in CSS.
 * Parsed from the style modules' rule strings when the canvas theme is
 * built (theme changes): no DOM is read, nothing runs per frame.
 */
interface RuleColors {
	activeLine?: string;
	activeLineBorder?: string;
	activeLineBorderWidth?: number;
	activeLineGutter?: string;
	gutterBackground?: string;
	gutterForeground?: string;
	gutterActiveForeground?: string;
	selection?: string;
	cursor?: string;
}

function collectStyleRules(
	extension: unknown,
	rules: string[],
	seen = new Set<unknown>(),
): string[] {
	if (!extension || typeof extension !== "object" || seen.has(extension)) {
		return rules;
	}
	seen.add(extension);
	if (Array.isArray(extension)) {
		for (const item of extension) collectStyleRules(item, rules, seen);
		return rules;
	}
	const node = extension as {
		getRules?: () => unknown;
		value?: unknown;
		inner?: unknown;
		extension?: unknown;
	};
	// A StyleModule (style-mod): one "selectors {declarations}" rule per line.
	if (typeof node.getRules === "function") {
		const text = node.getRules();
		if (typeof text === "string") rules.push(...text.split("\n"));
		return rules;
	}
	collectStyleRules(node.value, rules, seen);
	collectStyleRules(node.inner, rules, seen);
	collectStyleRules(node.extension, rules, seen);
	return rules;
}

const COLOR_TOKEN =
	/(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^)]*\)|#[0-9a-f]{3,8}\b|\b(?!inset\b)[a-z]+\b/i;

/** A color in a CSS value ("2px solid #333" -> "#333"); null for var(). */
function colorIn(value: string): string | null {
	if (/var\(/.test(value)) return null;
	const m = COLOR_TOKEN.exec(
		value.replace(/\b(?:solid|dashed|dotted|double|none)\b/g, ""),
	);
	if (
		!m ||
		/^(?:transparent|currentcolor|inherit|initial|unset)$/i.test(m[0])
	) {
		return m && /^transparent$/i.test(m[0]) ? "transparent" : null;
	}
	return m[0];
}

/** An inset box-shadow without offset or blur as a frame (`0 0 0 2px #333 inset`). */
function insetFrame(value: string): { color: string; width: number } | null {
	const first = value.split(/,(?![^(]*\))/)[0];
	if (!/\binset\b/.test(first)) return null;
	const color = colorIn(first.replace(/\binset\b/, ""));
	const lengths = (
		first.replace(COLOR_TOKEN, " ").match(/-?\d*\.?\d+(?:px)?\b/g) ?? []
	).map(Number.parseFloat);
	const [x = 0, y = 0, blur = 0, spread = 0] = lengths;
	if (!color || color === "transparent" || x || y || blur || !(spread > 0)) {
		return null;
	}
	return { color, width: spread };
}

export function themeRuleColors(extension: unknown): RuleColors {
	const found: RuleColors = {};
	let focusedSelection: string | undefined;
	for (const rule of collectStyleRules(extension, [])) {
		const m = /^([^{]+)\{([^}]*)\}\s*$/.exec(rule);
		if (!m) continue;
		const decls = new Map<string, string>();
		for (const decl of m[2].split(/;(?![^(]*\))/)) {
			const i = decl.indexOf(":");
			if (i > 0) decls.set(decl.slice(0, i).trim(), decl.slice(i + 1).trim());
		}
		const bg = decls.get("background-color") ?? decls.get("background");
		const bgColor = bg ? colorIn(bg) : null;
		for (const sel of m[1].split(",").map((s) => s.trim())) {
			// Only the element itself, not states or descendants of it.
			if (/:(?:hover|active|focus)|::/.test(sel)) continue;
			if (/\.cm-activeLine$/.test(sel)) {
				if (bgColor) found.activeLine = bgColor;
				const frame = decls.has("box-shadow")
					? insetFrame(decls.get("box-shadow") as string)
					: null;
				if (frame) {
					found.activeLineBorder = frame.color;
					found.activeLineBorderWidth = frame.width;
				}
			} else if (/\.cm-gutters$/.test(sel)) {
				if (bgColor) found.gutterBackground = bgColor;
				const color = decls.get("color");
				if (color && colorIn(color))
					found.gutterForeground = colorIn(color) as string;
			} else if (/\.cm-activeLineGutter$/.test(sel)) {
				if (bgColor) found.activeLineGutter = bgColor;
				const color = decls.get("color");
				if (color && colorIn(color))
					found.gutterActiveForeground = colorIn(color) as string;
			} else if (/\.cm-cursor(?:-primary)?$/.test(sel)) {
				const border =
					decls.get("border-left-color") ?? decls.get("border-left");
				const color = border ? colorIn(border) : null;
				if (color && color !== "transparent") found.cursor = color;
			} else if (/\.cm-selectionBackground$/.test(sel) && bgColor) {
				// The focused rule is what a focused editor shows.
				if (/\.cm-focused\b/.test(sel)) focusedSelection = bgColor;
				else found.selection ??= bgColor;
			}
		}
	}
	if (focusedSelection) found.selection = focusedSelection;
	return found;
}

/** Token colors from a theme config, for themes without a HighlightStyle. */
function highlightFromConfig(config: ThemeConfig): TokenStyleSpec[] {
	const color = (key: string) =>
		typeof config[key] === "string" ? (config[key] as string) : undefined;
	const specs: TokenStyleSpec[] = [
		{ tag: t.variableName, color: color("variable") },
		{ tag: [t.keyword, t.modifier], color: color("keyword") },
		{ tag: [t.string, t.special(t.string)], color: color("string") },
		{ tag: [t.number, t.bool, t.null], color: color("number") },
		{ tag: t.comment, color: color("comment"), fontStyle: "italic" },
		{
			tag: [t.function(t.variableName), t.function(t.propertyName)],
			color: color("function"),
		},
		{ tag: t.typeName, color: color("type") },
		{ tag: t.className, color: color("class") ?? color("type") },
		{
			tag: [t.constant(t.variableName), t.standard(t.variableName)],
			color: color("constant"),
		},
		{ tag: t.operator, color: color("operator") },
		{ tag: t.invalid, color: color("invalid") },
	];
	return specs.filter((spec) => spec.color);
}

/**
 * Decoration colors the canvas draws natively, as the themes' CSS has them:
 * selection matches use the theme's `selectionMatch`, else its selection.
 */
function themeClasses(config: ThemeConfig): CanvasThemeSpec["classes"] {
	const classes: NonNullable<CanvasThemeSpec["classes"]> = {};
	if (config.matchingBracket) {
		classes["cm-matchingBracket"] = { background: config.matchingBracket };
	}
	const selectionMatch = config.selectionMatch || config.selection;
	if (selectionMatch) {
		classes["cm-selectionMatch"] = { background: selectionMatch };
	}
	return Object.keys(classes).length ? classes : undefined;
}

/**
 * The canvas theme for an Acode editor theme: colors from its config, syntax
 * colors from the HighlightStyle in its extensions. The theme's
 * EditorView.theme stays in the state, where it styles the DOM UI (tooltips,
 * panels, autocomplete).
 */
/**
 * The canvas theme spec with the active line frame, which canvas-view
 * releases before it ignore (the line is then drawn without one).
 */
type FramedThemeSpec = CanvasThemeSpec & {
	activeLineBorder?: string;
	activeLineBorderWidth?: number;
};

export function getCanvasTheme(
	themeId: string,
	seeThrough = false,
): CanvasThemeSpec {
	// Resolve ids like getThemeExtensions does ("one-dark" -> "one_dark").
	const theme =
		getThemeById(themeId) || getThemeById(String(themeId).replace(/-/g, "_"));
	const config = (theme?.config ||
		getThemeConfig(themeId) ||
		{}) as ThemeConfig;
	const extensions = getThemeExtensions(themeId, [oneDark]);
	const highlight =
		findHighlightStyle(extensions) || highlightFromConfig(config);
	// What the config leaves out, from the theme's own CSS rules.
	const rules = themeRuleColors(extensions);
	const background = config.background || "#282c34";
	const foreground = config.foreground || "#abb2bf";
	// The config's active line replaces the rules' (fill and frame).
	const framed = !config.activeLine && rules.activeLineBorder;
	const activeLine = config.activeLine ?? rules.activeLine;
	const spec: FramedThemeSpec = {
		dark: config.dark !== false,
		// With a picture behind the editor, the canvas is see-through. The
		// editor element keeps the theme's CSS background under the picture,
		// and sticky lines take it from there.
		background: seeThrough ? "transparent" : background,
		foreground,
		selection: config.selection ?? rules.selection,
		cursor: config.cursor ?? rules.cursor,
		activeLine:
			seeThrough && !framed
				? translucentActiveLine(activeLine, foreground)
				: (activeLine ?? (framed ? "transparent" : undefined)),
		activeLineBorder: framed ? rules.activeLineBorder : undefined,
		activeLineBorderWidth: framed ? rules.activeLineBorderWidth : undefined,
		// Like the DOM themes, which give the active gutter line no background.
		activeLineGutter: seeThrough
			? "transparent"
			: (rules.activeLineGutter ?? background),
		gutterBackground: seeThrough ? undefined : rules.gutterBackground,
		gutterForeground: config.lineNumber ?? rules.gutterForeground,
		gutterActiveForeground:
			config.lineNumberActive ?? rules.gutterActiveForeground,
		// A line between the gutter and the code, only when the theme asks.
		gutterBorder: config.gutterBorder,
		// Acode draws its own (draggable) scrollbars over the editor.
		scrollbar: "transparent",
		highlight,
		classes: themeClasses(config),
	};
	return spec;
}

/**
 * An active line that lets a picture behind the editor show: the theme's
 * own when it already does, otherwise the text color at 8% (what the
 * Backdrop plugin gives `.cm-activeLine` in the DOM editor).
 */
function translucentActiveLine(
	activeLine: string | undefined,
	foreground: string,
): string {
	if (activeLine && parseColor(activeLine) >>> 24 < 255) return activeLine;
	const c = parseColor(foreground);
	return `rgba(${c & 255}, ${(c >>> 8) & 255}, ${(c >>> 16) & 255}, 0.08)`;
}

/**
 * Whether something draws a picture behind the editor's text, as the
 * Backdrop plugin does with `.cm-editor::before` (the DOM editor's text has
 * no background of its own, so it shows). A canvas view then needs a
 * see-through background. Reads computed style: call it outside frames.
 */
export function hasPictureBehind(view: CanvasView): boolean {
	if (!view.dom.isConnected) return false;
	const before = getComputedStyle(view.dom, "::before");
	return (
		before.content !== "none" &&
		before.content !== "normal" &&
		before.display !== "none" &&
		before.backgroundImage !== "none" &&
		Number(before.opacity) > 0
	);
}

/**
 * Call `onChange` (at most once per frame) when style sheets are added,
 * removed or rewritten, which is how plugins restyle the editor (Backdrop
 * keeps one `<style>` element up to date). Returns a function that stops.
 */
export function watchEditorStyles(onChange: () => void): () => void {
	let frame = 0;
	const isStyle = (node: Node | null) =>
		node instanceof HTMLStyleElement || node instanceof HTMLLinkElement;
	const observer = new MutationObserver((records) => {
		const relevant = records.some(
			(r) =>
				isStyle(r.target) ||
				isStyle(r.target.parentNode) ||
				[...r.addedNodes, ...r.removedNodes].some(isStyle),
		);
		if (!relevant || frame) return;
		frame = requestAnimationFrame(() => {
			frame = 0;
			onChange();
		});
	});
	const options = { childList: true, subtree: true, characterData: true };
	observer.observe(document.head, options);
	// Style elements put straight into <body> (not its whole subtree: the
	// editor's own DOM changes all the time).
	observer.observe(document.body, { childList: true });
	return () => {
		observer.disconnect();
		if (frame) cancelAnimationFrame(frame);
	};
}

/** A CSS font size ("12px", "1rem", "10pt"...) in CSS pixels. */
export function fontSizeToPx(value: unknown): number {
	const match = /^([\d.]+)\s*([a-z]*)$/i.exec(String(value ?? "").trim());
	if (!match) return 12;
	const size = Number.parseFloat(match[1]);
	if (!Number.isFinite(size) || size <= 0) return 12;
	const unit = match[2].toLowerCase();
	const rootSize = () =>
		Number.parseFloat(getComputedStyle(document.documentElement).fontSize) ||
		16;
	switch (unit) {
		case "pt":
			return (size * 4) / 3;
		case "pc":
			return size * 16;
		case "in":
			return size * 96;
		case "mm":
			return (size * 96) / 25.4;
		case "em":
		case "rem":
			return size * rootSize();
		default:
			return size;
	}
}

/** Same font size and line height as `makeFontTheme` gives the DOM editor. */
export function getCanvasFont(settings: Settings, family: string): FontSpec {
	const lineHeight = Number(settings.lineHeight);
	return {
		family,
		size: fontSizeToPx(settings.fontSize || "12px"),
		lineHeight:
			Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight : 1.4,
	};
}

/** Display options from Acode's editor settings (the live ones). */
export function getCanvasDisplayOptions(
	settings: Settings,
	{
		themeId,
		onLineNumberClick,
	}: {
		themeId: string;
		onLineNumberClick?: CanvasViewConfig["onLineNumberClick"];
	},
): CanvasDisplayOptions {
	const { linenumbers = true, relativeLineNumbers = false } = settings;
	const cursorWidth = Number(settings.cursorWidth);
	const showSpaces = !!settings.showSpaces;
	const rainbow = settings.rainbowBrackets ?? true;
	return {
		lineNumbers: linenumbers
			? relativeLineNumbers
				? "relative"
				: true
			: false,
		onLineNumberClick,
		foldMarkers:
			settings.codeFolding === false
				? "none"
				: settings.fadeFoldWidgets
					? "fade"
					: "always",
		highlightActiveLine: settings.highlightActiveLine !== false,
		cursorWidth:
			Number.isFinite(cursorWidth) && cursorWidth > 0
				? Math.min(cursorWidth, 10)
				: 2,
		// 0 keeps the cursor steady.
		cursorBlinkRate: clampSetting(settings.cursorBlinkRate, 0, 10000, 1200),
		gutterMarkers: GUTTER_MARKERS.includes(settings.canvasGutterMarkers)
			? settings.canvasGutterMarkers
			: "shared",
		lineWrapping: !!settings.textWrap,
		wrapIndent: settings.wrappingIndent ?? "same",
		textDirection: settings.rtlText ? "auto" : "ltr",
		horizontalScrollPastEnd: Number(settings.leftMargin ?? 50) || 0,
		scrollPastEnd: SCROLL_PAST_END[settings.scrollPastEnd || "medium"] ?? 1,
		scrollSpeed: SCROLL_SPEED[settings.scrollSpeed] ?? "normal",
		// Unlike the DOM editor's guides, the block around the cursor is
		// highlighted: it's one rect per frame on the canvas.
		indentGuides: settings.indentGuides ? { active: true } : false,
		rainbowBrackets: rainbow
			? { colors: getRainbowBracketColors(getThemeConfig(themeId)) }
			: false,
		showWhitespace: showSpaces
			? { spaces: true, trailing: true, lineBreaks: true }
			: false,
		stickyScroll: settings.stickyScroll
			? { maxLines: clampSetting(settings.stickyScrollMaxLines, 1, 10, 5) }
			: false,
	};
}

const CANVAS_BACKENDS = ["auto", "webgl2", "webgpu"] as const;

/** The GPU API for new canvas views ("webgpu" falls back to WebGL2). */
export function getCanvasBackend(
	settings: Settings,
): CanvasViewConfig["backend"] {
	const value = settings.canvasBackend;
	return CANVAS_BACKENDS.includes(value) ? value : "auto";
}

interface CanvasSyncState {
	display?: string;
	font?: string;
	theme?: string;
}

const synced = new WeakMap<CanvasView, CanvasSyncState>();

const themeEntryIds = new WeakMap<object, number>();
let nextThemeEntryId = 1;

/**
 * Which registered theme an id resolves to, for the sync key. A plugin
 * theme is registered after the editor is created: until then its id falls
 * back to One Dark's colors, and applying the same id again once it's
 * registered must rebuild the canvas theme (it used to be skipped, leaving
 * a cold-started canvas editor in One Dark's colors).
 */
function themeEntryKey(themeId: string): string {
	const entry =
		getThemeById(themeId) || getThemeById(String(themeId).replace(/-/g, "_"));
	if (!entry) return "0";
	let n = themeEntryIds.get(entry);
	if (!n) themeEntryIds.set(entry, (n = nextThemeEntryId++));
	return String(n);
}
// Acode replaces `setTheme` on editor instances with its own (taking a theme
// id), so the view's method is called through the prototype.
const setViewTheme = CanvasView.prototype.setTheme;

/**
 * Bring a canvas view in line with the settings. Each part is applied only
 * when it changed: reconfiguring resets the drawn scene, and a new font or a
 * dark/light switch rebuilds the glyph atlas.
 */
export function syncCanvasView(
	view: CanvasView,
	{
		display,
		font,
		themeId,
	}: { display?: CanvasDisplayOptions; font?: FontSpec; themeId?: string },
): void {
	let state = synced.get(view);
	if (!state) {
		state = {};
		synced.set(view, state);
	}
	if (display) {
		// Functions (onLineNumberClick) are left out of the key: they read
		// settings when called.
		const key = JSON.stringify(display);
		if (key !== state.display) {
			state.display = key;
			view.reconfigure(display);
		}
	}
	if (font) {
		const key = JSON.stringify(font);
		if (key !== state.font) {
			state.font = key;
			view.setFont(font);
		}
	}
	if (themeId != null) {
		const id = String(themeId);
		const seeThrough = hasPictureBehind(view);
		const key = `${id}\0${seeThrough}\0${themeEntryKey(id)}`;
		if (key !== state.theme) {
			state.theme = key;
			setViewTheme.call(view, getCanvasTheme(id, seeThrough));
		}
	}
}

/** Remember what a new view was created with, so syncing skips it. */
export function markCanvasViewSynced(
	view: CanvasView,
	{
		display,
		font,
		themeId,
	}: { display: CanvasDisplayOptions; font: FontSpec; themeId: string },
): void {
	synced.set(view, {
		display: JSON.stringify(display),
		font: JSON.stringify(font),
		theme: `${themeId}\0false\0${themeEntryKey(String(themeId))}`,
	});
}

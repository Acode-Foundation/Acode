import {
	type CanvasThemeSpec,
	CanvasView,
	type CanvasViewConfig,
	type FontSpec,
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
export function getCanvasTheme(themeId: string): CanvasThemeSpec {
	// Resolve ids like getThemeExtensions does ("one-dark" -> "one_dark").
	const theme =
		getThemeById(themeId) || getThemeById(String(themeId).replace(/-/g, "_"));
	const config = (theme?.config ||
		getThemeConfig(themeId) ||
		{}) as ThemeConfig;
	const highlight =
		findHighlightStyle(getThemeExtensions(themeId, [oneDark])) ||
		highlightFromConfig(config);
	return {
		dark: config.dark !== false,
		background: config.background || "#282c34",
		foreground: config.foreground || "#abb2bf",
		selection: config.selection,
		cursor: config.cursor,
		activeLine: config.activeLine,
		// Like the DOM themes, which give the active gutter line no background.
		activeLineGutter: config.background,
		gutterForeground: config.lineNumber,
		gutterActiveForeground: config.lineNumberActive,
		// Acode draws its own (draggable) scrollbars over the editor.
		scrollbar: "transparent",
		highlight,
		classes: themeClasses(config),
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
		foldMarkers: settings.fadeFoldWidgets ? "fade" : "always",
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
		const key = String(themeId);
		if (key !== state.theme) {
			state.theme = key;
			setViewTheme.call(view, getCanvasTheme(key));
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
		theme: String(themeId),
	});
}

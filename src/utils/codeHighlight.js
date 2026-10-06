import { classHighlighter, highlightCode } from "@lezer/highlight";
import { getModeForPath, getModesByName } from "cm/modelist";
import { getThemeConfig } from "cm/themes";
import DOMPurify from "dompurify";
import settings from "lib/settings";

const highlightCache = new Map();
const MAX_CACHE_SIZE = 500;
const STYLE_ID = "cm-static-highlight-styles";

export const HIGHLIGHT_CLASS = "cm-highlighted";
export const REF_PREVIEW_CLASS = "ref-preview";

let styleElement = null;
let constructedSheet = null;
let currentThemeId = null;
let initialized = false;
const fallbackStyleElements = new Set();

export function sanitize(text) {
	if (!text) return "";
	return DOMPurify.sanitize(text, { ALLOWED_TAGS: [] });
}

function escapeHtml(text) {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function escapeRegExp(string) {
	return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function addSymbolHighlight(html, symbol) {
	if (!symbol) return html;
	const escapedSymbol = escapeRegExp(sanitize(symbol));
	const regex = new RegExp(`(${escapedSymbol})`, "gi");
	return html.replace(regex, '<span class="symbol-match">$1</span>');
}

function setCache(key, value) {
	if (highlightCache.size >= MAX_CACHE_SIZE) {
		const firstKey = highlightCache.keys().next().value;
		highlightCache.delete(firstKey);
	}
	highlightCache.set(key, value);
}

function canUseConstructedStyleSheets() {
	return (
		typeof CSSStyleSheet !== "undefined" &&
		typeof CSSStyleSheet.prototype.replaceSync === "function"
	);
}

function currentEditorThemeId() {
	return settings?.value?.editorTheme || "one_dark";
}

/**
 * Generates CSS styles for syntax highlighting tokens
 * @param {Object} config - Theme config with color values
 * @param {string} selector - CSS selector to scope styles
 * @param {boolean} includeBackground - Whether to include background/foreground base styles
 */
function generateStyles(config, selector, includeBackground = true) {
	const c = config;
	const keyword = c.keyword || "#c678dd";
	const string = c.string || "#98c379";
	const number = c.number || "#d19a66";
	const comment = c.comment || "#5c6370";
	const func = c.function || "#61afef";
	const variable = c.variable || "#e06c75";
	const type = c.type || "#e5c07b";
	const className = c.class || type;
	const constant = c.constant || number;
	const operator = c.operator || keyword;
	const invalid = c.invalid || "#ff6b6b";
	const foreground = c.foreground || "#abb2bf";
	const background = c.background || "#282c34";

	const baseStyles = includeBackground
		? `
${selector} {
  background: ${background};
  color: ${foreground};
}`
		: "";

	return `${baseStyles}
${selector} .tok-keyword { color: ${keyword}; }
${selector} .tok-operator { color: ${operator}; }
${selector} .tok-number { color: ${number}; }
${selector} .tok-string { color: ${string}; }
${selector} .tok-comment { color: ${comment}; font-style: italic; }
${selector} .tok-variableName { color: ${variable}; }
${selector} .tok-propertyName { color: ${func}; }
${selector} .tok-typeName { color: ${type}; }
${selector} .tok-className { color: ${className}; }
${selector} .tok-function { color: ${func}; }
${selector} .tok-bool { color: ${constant}; }
${selector} .tok-null { color: ${constant}; }
${selector} .tok-punctuation { color: ${foreground}; }
${selector} .tok-definition { color: ${variable}; }
${selector} .tok-labelName { color: ${variable}; }
${selector} .tok-namespace { color: ${type}; }
${selector} .tok-macroName { color: ${keyword}; }
${selector} .tok-atom { color: ${constant}; }
${selector} .tok-meta { color: ${foreground}; }
${selector} .tok-heading { color: ${variable}; font-weight: bold; }
${selector} .tok-link { color: ${func}; text-decoration: underline; }
${selector} .tok-strikethrough { text-decoration: line-through; }
${selector} .tok-emphasis { font-style: italic; }
${selector} .tok-strong { font-weight: bold; }
${selector} .tok-invalid { color: ${invalid}; }
${selector} .tok-name { color: ${variable}; }
${selector} .tok-deleted { color: ${invalid}; }
${selector} .tok-inserted { color: ${string}; }
${selector} .tok-changed { color: ${number}; }
`.trim();
}

/**
 * CSS for the current editor theme. Token classes come from Lezer's
 * `classHighlighter` (e.g. `.tok-keyword`).
 * @returns {string}
 */
export function getHighlightStyles() {
	const config = getThemeConfig(currentEditorThemeId());
	const codeBlockStyles = generateStyles(config, `.${HIGHLIGHT_CLASS}`, true);
	const refPreviewStyles = generateStyles(
		config,
		`.${REF_PREVIEW_CLASS}`,
		false,
	);
	return `${codeBlockStyles}\n${refPreviewStyles}`;
}

function ensureConstructedSheet(css) {
	if (!canUseConstructedStyleSheets()) return null;
	if (!constructedSheet) {
		constructedSheet = new CSSStyleSheet();
	}
	constructedSheet.replaceSync(css);
	return constructedSheet;
}

function syncFallbackStyleElements(css) {
	for (const style of fallbackStyleElements) {
		// `isConnected` is false while a custom-tab host is still detached.
		// Keep updating those nodes; only drop styles that have been removed.
		if (!style.parentNode) {
			fallbackStyleElements.delete(style);
			continue;
		}
		style.textContent = css;
	}
}

function injectDocumentStyleElement(css) {
	if (typeof document === "undefined") return null;
	if (!styleElement || !styleElement.isConnected) {
		styleElement = document.createElement("style");
		styleElement.id = STYLE_ID;
		(document.head || document.documentElement).appendChild(styleElement);
	}
	styleElement.textContent = css;
	return styleElement;
}

/**
 * Rebuilds the shared highlight stylesheet from the current editor theme.
 * Constructed-sheet adopters update automatically via `replaceSync`.
 */
function syncHighlightStyles() {
	const css = getHighlightStyles();
	currentThemeId = currentEditorThemeId();
	ensureConstructedSheet(css);
	injectDocumentStyleElement(css);
	syncFallbackStyleElements(css);
	return css;
}

function resolveStyleRoot(root) {
	if (!root || root === document) return document;
	if (typeof ShadowRoot !== "undefined" && root instanceof ShadowRoot) {
		return root;
	}
	if (root.shadowRoot) return root.shadowRoot;
	return root;
}

function adoptSheet(root, sheet) {
	if (!sheet || !root || !("adoptedStyleSheets" in root)) return false;
	try {
		const sheets = Array.from(root.adoptedStyleSheets || []);
		if (sheets.includes(sheet)) return true;
		root.adoptedStyleSheets = [...sheets, sheet];
		return true;
	} catch (e) {
		console.warn("Failed to adopt highlight stylesheet", e);
		return false;
	}
}

function injectFallbackStyle(root, css) {
	const owner =
		root === document ? document.head || document.documentElement : root;
	if (!owner || typeof owner.appendChild !== "function") return null;

	let style = null;
	if (typeof owner.querySelector === "function") {
		style = owner.querySelector(`#${STYLE_ID}`);
	}

	if (!style) {
		style = document.createElement("style");
		style.id = STYLE_ID;
		owner.appendChild(style);
	}

	style.textContent = css;
	fallbackStyleElements.add(style);
	return style;
}

/**
 * Shared constructed stylesheet used for document + shadow roots.
 * @returns {CSSStyleSheet|null}
 */
export function getHighlightStyleSheet() {
	syncHighlightStyles();
	return constructedSheet;
}

/**
 * Applies current-theme highlight CSS to a document or shadow root.
 * Custom editor tabs opt in with `highlightStyles: true`. Call this
 * for other shadow roots (dialogs, custom elements) that insert
 * highlighted HTML.
 *
 * Prefers `adoptedStyleSheets` so theme changes update in place.
 *
 * @param {Document|ShadowRoot|ParentNode|null} [root=document]
 * @returns {CSSStyleSheet|HTMLStyleElement|null}
 */
export function applyHighlightStyles(root = document) {
	const css = syncHighlightStyles();
	const target = resolveStyleRoot(root);

	if (constructedSheet && adoptSheet(target, constructedSheet)) {
		return constructedSheet;
	}

	if (target === document) {
		return styleElement;
	}

	return injectFallbackStyle(target, css);
}

/**
 * Injects dynamic CSS for syntax highlighting based on current editor theme
 */
function injectStyles() {
	applyHighlightStyles(document);
}

/**
 * Gets the language parser for a given URI using the modelist
 */
async function getLanguageParser(uri) {
	const mode = getModeForPath(uri);
	if (!mode?.languageExtension) return null;

	try {
		const langExt = await mode.languageExtension();
		if (!langExt) return null;

		const langArray = Array.isArray(langExt) ? langExt : [langExt];
		for (const ext of langArray) {
			if (ext && typeof ext === "object" && "language" in ext) {
				return ext.language.parser;
			}
		}
	} catch (e) {
		console.warn("Failed to get language parser for", uri, e);
	}
	return null;
}

/**
 * Gets language parser by language name (e.g., "javascript", "python")
 * Uses modelist to find the mode and get first valid extension for file matching
 */
async function getParserForLanguage(langName) {
	if (!langName) return null;

	const modesByName = getModesByName();
	const normalizedName = langName.toLowerCase();

	// Try to find mode by name (case-insensitive)
	const mode = modesByName[normalizedName];
	if (mode?.languageExtension) {
		try {
			const langExt = await mode.languageExtension();
			if (!langExt) return null;

			const langArray = Array.isArray(langExt) ? langExt : [langExt];
			for (const ext of langArray) {
				if (ext && typeof ext === "object" && "language" in ext) {
					return ext.language.parser;
				}
			}
		} catch (e) {
			console.warn("Failed to get parser for language:", langName, e);
		}
	}

	// Fallback: create a fake filename and use getModeForPath
	// This handles cases where the language name doesn't match mode name exactly
	const fakeUri = `file.${normalizedName}`;
	return await getLanguageParser(fakeUri);
}

/**
 * Highlights a single line of code for display in references panel
 * @param {string} text - The line of code to highlight
 * @param {string} uri - File URI for language detection
 * @param {string|null} symbolName - Optional symbol to highlight with special styling
 */
export async function highlightLine(text, uri, symbolName = null) {
	if (!text || !text.trim()) return "";

	const themeId = currentEditorThemeId();
	const cacheKey = `line:${themeId}:${uri}:${text}:${symbolName || ""}`;

	if (highlightCache.has(cacheKey)) {
		return highlightCache.get(cacheKey);
	}

	const trimmedText = text.trim();

	try {
		const parser = await getLanguageParser(uri);
		if (parser) {
			const tree = parser.parse(trimmedText);
			let result = "";

			highlightCode(
				trimmedText,
				tree,
				classHighlighter,
				(code, classes) => {
					if (classes) {
						result += `<span class="${classes}">${escapeHtml(code)}</span>`;
					} else {
						result += escapeHtml(code);
					}
				},
				() => {},
			);

			if (result) {
				const highlighted = symbolName
					? addSymbolHighlight(result, symbolName)
					: result;
				setCache(cacheKey, highlighted);
				return highlighted;
			}
		}
	} catch (e) {
		console.warn("Highlighting failed for", uri, e);
	}

	const escaped = escapeHtml(trimmedText);
	const highlighted = symbolName
		? addSymbolHighlight(escaped, symbolName)
		: escaped;
	setCache(cacheKey, highlighted);
	return highlighted;
}

/**
 * Highlights a code block for display in markdown/plugin pages
 * @param {string} code - The code to highlight
 * @param {string} language - Language identifier from markdown fence (e.g., "javascript", "python")
 */
export async function highlightCodeBlock(code, language) {
	if (!code) return "";

	const themeId = currentEditorThemeId();
	const langKey = (language || "text").toLowerCase();

	const cacheKey = `block:${themeId}:${langKey}:${code}`;
	if (highlightCache.has(cacheKey)) {
		return highlightCache.get(cacheKey);
	}

	try {
		const parser = await getParserForLanguage(langKey);
		if (parser) {
			const tree = parser.parse(code);
			let result = "";

			highlightCode(
				code,
				tree,
				classHighlighter,
				(text, classes) => {
					if (classes) {
						result += `<span class="${classes}">${escapeHtml(text)}</span>`;
					} else {
						result += escapeHtml(text);
					}
				},
				() => {
					result += "\n";
				},
			);

			if (result) {
				setCache(cacheKey, result);
				return result;
			}
		}
	} catch (e) {
		console.warn("Code block highlighting failed for", language, e);
	}

	const escaped = escapeHtml(code);
	setCache(cacheKey, escaped);
	return escaped;
}

export function clearHighlightCache() {
	highlightCache.clear();
}

/**
 * Initializes the static code highlighting system.
 * Injects theme-based CSS and sets up listener for theme changes.
 */
export function initHighlighting() {
	injectStyles();

	if (initialized) return;
	initialized = true;

	settings.on("update:editorTheme:after", () => {
		const newThemeId = currentEditorThemeId();
		if (newThemeId !== currentThemeId) {
			injectStyles();
			highlightCache.clear();
		}
	});
}

export default {
	sanitize,
	highlightLine,
	highlightCodeBlock,
	clearHighlightCache,
	initHighlighting,
	applyHighlightStyles,
	getHighlightStyles,
	getHighlightStyleSheet,
	HIGHLIGHT_CLASS,
	REF_PREVIEW_CLASS,
};

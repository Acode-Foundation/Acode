import { classHighlighter, highlightCode } from "@lezer/highlight";
import { getModeForPath, getModesByName } from "cm/modelist";
import { getThemeConfig } from "cm/themes";
import DOMPurify from "dompurify";
import settings from "lib/settings";

const highlightCache = new Map();
const MAX_CACHE_SIZE = 500;

let styleElement = null;
let currentThemeId = null;

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
 * Injects dynamic CSS for syntax highlighting based on current editor theme
 */
function injectStyles() {
	const themeId = settings?.value?.editorTheme || "one_dark";
	const config = getThemeConfig(themeId);

	// Code blocks need background, references panel uses parent's background
	const codeBlockStyles = generateStyles(config, ".cm-highlighted", true);
	const refPreviewStyles = generateStyles(config, ".ref-preview", false);
	const allStyles = `${codeBlockStyles}\n${refPreviewStyles}`;

	if (!styleElement) {
		styleElement = document.createElement("style");
		styleElement.id = "cm-static-highlight-styles";
		document.head.appendChild(styleElement);
	}

	styleElement.textContent = allStyles;
	currentThemeId = themeId;
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

	const themeId = settings?.value?.editorTheme || "one_dark";
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

	const themeId = settings?.value?.editorTheme || "one_dark";
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

	settings.on("update:editorTheme:after", () => {
		const newThemeId = settings?.value?.editorTheme || "one_dark";
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
};

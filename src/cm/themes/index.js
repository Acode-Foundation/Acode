import { EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import aura, { config as auraConfig } from "./aura";
import dracula, { config as draculaConfig } from "./dracula";
import githubDark, { config as githubDarkConfig } from "./githubDark";
import githubLight, { config as githubLightConfig } from "./githubLight";
import monokai, { config as monokaiConfig } from "./monokai";
import noctisLilac, { config as noctisLilacConfig } from "./noctisLilac";
import solarizedDark, { config as solarizedDarkConfig } from "./solarizedDark";
import solarizedLight, {
	config as solarizedLightConfig,
} from "./solarizedLight";
import tokyoNight, { config as tokyoNightConfig } from "./tokyoNight";
import tokyoNightDay, { config as tokyoNightDayConfig } from "./tokyoNightDay";
import tomorrowNight, { config as tomorrowNightConfig } from "./tomorrowNight";
import tomorrowNightBright, {
	config as tomorrowNightBrightConfig,
} from "./tomorrowNightBright";
import vscodeDark, { config as vscodeDarkConfig } from "./vscodeDark";

const oneDarkConfig = {
	name: "one_dark",
	dark: true,
	background: "#282c34",
	foreground: "#abb2bf",
	keyword: "#c678dd",
	string: "#98c379",
	number: "#d19a66",
	comment: "#5c6370",
	function: "#61afef",
	variable: "#e06c75",
	type: "#e5c07b",
	class: "#e5c07b",
	constant: "#d19a66",
	operator: "#56b6c2",
	invalid: "#ff6b6b",
};

const themes = new Map();
const warnedInvalidThemes = new Set();

function normalizeExtensions(value, target = []) {
	if (Array.isArray(value)) {
		value.forEach((item) => normalizeExtensions(item, target));
		return target;
	}

	if (value !== null && value !== undefined) {
		target.push(value);
	}

	return target;
}

function toExtensionGetter(getExtension) {
	if (typeof getExtension === "function") {
		return () => normalizeExtensions(getExtension());
	}

	return () => normalizeExtensions(getExtension);
}

function logInvalidThemeOnce(themeId, error, reason = "") {
	if (warnedInvalidThemes.has(themeId)) return;
	warnedInvalidThemes.add(themeId);
	const message = reason
		? `[editorThemes] Theme '${themeId}' is invalid: ${reason}`
		: `[editorThemes] Theme '${themeId}' is invalid.`;
	console.error(message, error);
}

function validateThemeExtensions(themeId, extensions) {
	if (!extensions.length) {
		logInvalidThemeOnce(themeId, null, "no extensions were returned");
		return false;
	}

	try {
		// Validate against Acode's own CodeMirror instance.
		EditorState.create({ doc: "", extensions });
		return true;
	} catch (error) {
		logInvalidThemeOnce(themeId, error);
		return false;
	}
}

function resolveThemeEntryExtensions(theme, fallbackExtensions) {
	const fallback = fallbackExtensions.length
		? [...fallbackExtensions]
		: [oneDark];

	if (!theme) return fallback;

	try {
		const resolved = normalizeExtensions(theme.getExtension?.());
		if (!validateThemeExtensions(theme.id, resolved)) {
			return fallback;
		}
		return resolved;
	} catch (error) {
		logInvalidThemeOnce(theme.id, error);
		return fallback;
	}
}

export function addTheme(id, caption, isDark, getExtension, config = null) {
	const key = String(id || "")
		.trim()
		.toLowerCase();
	if (!key || themes.has(key)) return false;

	const theme = {
		id: key,
		caption: caption || id,
		isDark: !!isDark,
		getExtension: toExtensionGetter(getExtension),
		config: config || null,
	};

	if (!validateThemeExtensions(key, theme.getExtension())) {
		return false;
	}

	themes.set(key, theme);
	return true;
}

export function getThemes() {
	return Array.from(themes.values());
}

export function getThemeById(id) {
	if (!id) return null;
	return themes.get(String(id).toLowerCase()) || null;
}

export function getThemeConfig(id) {
	if (!id) return oneDarkConfig;
	const theme = themes.get(String(id).toLowerCase());
	return theme?.config || oneDarkConfig;
}

export function getThemeExtensions(id, fallback = [oneDark]) {
	const fallbackExtensions = normalizeExtensions(fallback);
	const theme =
		getThemeById(id) || getThemeById(String(id || "").replace(/-/g, "_"));
	return resolveThemeEntryExtensions(theme, fallbackExtensions);
}

export function removeTheme(id) {
	if (!id) return;
	themes.delete(String(id).toLowerCase());
}

addTheme("one_dark", "One Dark", true, () => [oneDark], oneDarkConfig);
addTheme(auraConfig.name, "Aura", !!auraConfig.dark, () => aura(), auraConfig);
addTheme(
	noctisLilacConfig.name,
	noctisLilacConfig.caption || "Noctis Lilac",
	!!noctisLilacConfig.dark,
	() => noctisLilac(),
	noctisLilacConfig,
);
addTheme(
	draculaConfig.name,
	"Dracula",
	!!draculaConfig.dark,
	() => dracula(),
	draculaConfig,
);
addTheme(
	githubDarkConfig.name,
	"GitHub Dark",
	!!githubDarkConfig.dark,
	() => githubDark(),
	githubDarkConfig,
);
addTheme(
	githubLightConfig.name,
	"GitHub Light",
	!!githubLightConfig.dark,
	() => githubLight(),
	githubLightConfig,
);
addTheme(
	solarizedDarkConfig.name,
	"Solarized Dark",
	!!solarizedDarkConfig.dark,
	() => solarizedDark(),
	solarizedDarkConfig,
);
addTheme(
	solarizedLightConfig.name,
	"Solarized Light",
	!!solarizedLightConfig.dark,
	() => solarizedLight(),
	solarizedLightConfig,
);
addTheme(
	tokyoNightDayConfig.name,
	"Tokyo Night Day",
	!!tokyoNightDayConfig.dark,
	() => tokyoNightDay(),
	tokyoNightDayConfig,
);
addTheme(
	tokyoNightConfig.name,
	"Tokyo Night",
	!!tokyoNightConfig.dark,
	() => tokyoNight(),
	tokyoNightConfig,
);
addTheme(
	tomorrowNightConfig.name,
	"Tomorrow Night",
	!!tomorrowNightConfig.dark,
	() => tomorrowNight(),
	tomorrowNightConfig,
);
addTheme(
	tomorrowNightBrightConfig.name,
	"Tomorrow Night Bright",
	!!tomorrowNightBrightConfig.dark,
	() => tomorrowNightBright(),
	tomorrowNightBrightConfig,
);
addTheme(
	monokaiConfig.name,
	"Monokai",
	!!monokaiConfig.dark,
	() => monokai(),
	monokaiConfig,
);
addTheme(
	vscodeDarkConfig.name,
	"VS Code Dark",
	!!vscodeDarkConfig.dark,
	() => vscodeDark(),
	vscodeDarkConfig,
);

export default {
	getThemes,
	getThemeById,
	getThemeConfig,
	getThemeExtensions,
	addTheme,
	removeTheme,
};

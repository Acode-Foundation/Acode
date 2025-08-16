import fsOperation from "fileSystem";
import { isDeviceDarkTheme } from "lib/systemConfiguration";
import color from "utils/color";
import Url from "utils/Url";
import fonts from "../lib/fonts";
import settings from "../lib/settings";
import ThemeBuilder from "./builder";
import themes, { updateSystemTheme } from "./preInstalled";

/** @type {Map<string, ThemeBuilder>} */
const appThemes = new Map();
let themeApplied = false;
let firstTime = true;

function init() {
	themes.forEach((theme) => add(theme));
}

/**
 * @typedef {object} Theme
 * @property {string} id
 * @property {string} name
 * @property {string} type
 * @property {string} version
 * @property {string} primaryColor
 */

/**
 * Returns a list of all themes
 * @returns {Theme[]}
 */
function list() {
	return Array.from(appThemes.keys()).map((name) => {
		const { id, type, primaryColor, version } = appThemes.get(name);
		return {
			id,
			type,
			version,
			primaryColor,
			name: name.capitalize(),
		};
	});
}

/**
 *
 * @param {string} name
 * @returns {ThemeBuilder}
 */
function get(name) {
	return appThemes.get(name.toLowerCase());
}

/**
 *
 * @param {ThemeBuilder} theme
 * @returns
 */
function add(theme) {
	if (!(theme instanceof ThemeBuilder)) return;
	if (appThemes.has(theme.id)) return;

	appThemes.set(theme.id, theme);

	const { appTheme } = settings.value;

	if (theme.matches(appTheme)) {
		if (appTheme !== "system") {
			apply(appTheme);
		} else {
			updateSystemTheme(isDeviceDarkTheme());
			themeApplied = true;
		}
	}
}

/**
 * Apply a theme
 * @param {string} id The name of the theme to apply
 * @param {boolean} init Whether or not this is the first time the theme is being applied
 */
export async function apply(id, init) {
	if (!DOES_SUPPORT_THEME) {
		id = "default";
	}

	themeApplied = true;
	const loaderFile = Url.join(ASSETS_DIRECTORY, "res/tail-spin.svg");
	const svgName = "__tail-spin__.svg";
	const img = Url.join(DATA_STORAGE, svgName);
	const theme = get(id);
	const $style = document.head.get("style#app-theme") ?? (
		<style id="app-theme"></style>
	);
	const update = {
		appTheme: id,
	};

	if (id === "custom") {
		update.customTheme = theme.toJSON();
	}

	if (init && theme.preferredEditorTheme) {
		update.editorTheme = theme.preferredEditorTheme;
		if (editorManager != null && editorManager.editor != null) {
			editorManager.editor.setTheme(theme.preferredEditorTheme);
		}
	}

	if (init && theme.preferredFont) {
		update.editorFont = theme.preferredFont;
		fonts.setFont(theme.preferredFont);
	}

	settings.update(update, false);
	localStorage.__primary_color = theme.primaryColor;
	document.body.setAttribute("theme-type", theme.type);
	$style.textContent = theme.css;
	document.head.append($style);

	const primaryColor = color(theme.primaryColor).hex.toString();
	const scheme = theme.toJSON("hex");
	// Set status bar and navigation bar color
	system.setUiTheme(primaryColor, scheme);

	if (firstTime) {
		// To make sure system bars are updated
		setTimeout(() => {
			system.setUiTheme(primaryColor, scheme);
		}, 1000);
		firstTime = false;
	}

	try {
		let fs = fsOperation(loaderFile);
		const svg = await fs.readFile("utf8");

		fs = fsOperation(img);
		if (!(await fs.exists())) {
			await fsOperation(DATA_STORAGE).createFile(svgName);
		}
		await fs.writeFile(svg.replace(/#fff/g, theme.primaryColor));
	} catch (error) {
		window.log("error", error);
	}
}

/**
 * Update a theme
 * @param {ThemeBuilder} theme
 */
export function update(theme) {
	if (!(theme instanceof ThemeBuilder)) return;
	const oldTheme = get(theme.id);
	if (!oldTheme) {
		add(theme);
		return;
	}
	const json = theme.toJSON();
	Object.keys(json).forEach((key) => {
		oldTheme[key] = json[key];
	});
}

export default {
	get applied() {
		return themeApplied;
	},
	init,
	list,
	get,
	add,
	apply,
	update,
};

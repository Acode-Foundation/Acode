import themes from "theme/list";
import Color from "utils/color";
import config from "./config";
import appSettings from "./settings";

let count = 0;

/**
 * Restores the theme or darkens the status bar and navigation bar
 * Used when dialogs are opened which has mask that darkens the background
 * @param {boolean} darken Whether to darken the status bar and navigation bar
 * @returns
 */
export default function restoreTheme(darken = false) {
	if (!count && !darken) return;
	count += darken ? 1 : -1;
	if (darken !== !!count) return;
	if (darken && document.body.classList.contains("loading")) return;

	let themeName = DOES_SUPPORT_THEME ? appSettings.value.appTheme : "default";
	let theme = themes.get(themeName);

	if (theme?.version !== "free" && !config.HAS_PRO) {
		themeName = "default";
		theme = themes.get(themeName);
		appSettings.value.appTheme = themeName;
		appSettings.update();
	}

	if (
		!theme.darkenedPrimaryColor ||
		theme.darkenedPrimaryColor === theme.primaryColor
	) {
		theme.darkenPrimaryColor();
	}
	const color = darken ? theme.darkenedPrimaryColor : theme.primaryColor;
	const hexColor = Color(color).hex.toString();
	system.setUiTheme(hexColor, theme.toJSON("hex"));
}

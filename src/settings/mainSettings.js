import settingsPage from "components/settingsPage";
import confirm from "dialogs/confirm";
import rateBox from "dialogs/rateBox";
import actionStack from "lib/actionStack";
import openFile from "lib/openFile";
import removeAds from "lib/removeAds";
import appSettings from "lib/settings";
import settings from "lib/settings";
import Changelog from "pages/changelog/changelog";
import plugins from "pages/plugins";
import Sponsors from "pages/sponsors";
import themeSetting from "pages/themeSetting";
import helpers from "utils/helpers";
import About from "../pages/about";
import otherSettings from "./appSettings";
import backupRestore from "./backupRestore";
import editorSettings from "./editorSettings";
import filesSettings from "./filesSettings";
import formatterSettings from "./formatterSettings";
import previewSettings from "./previewSettings";
import scrollSettings from "./scrollSettings";
import searchSettings from "./searchSettings";
import terminalSettings from "./terminalSettings";

export default function mainSettings() {
	const title = strings.settings.capitalize();
	const items = [
		{
			key: "about",
			text: strings.about,
			icon: "acode",
			index: 0,
		},
		{
			key: "sponsors",
			text: strings.sponsor,
			icon: "favorite",
			iconColor: "orangered",
			index: 1,
		},
		{
			key: "editor-settings",
			text: strings["editor settings"],
			icon: "text_format",
			index: 3,
		},
		{
			key: "app-settings",
			text: strings["app settings"],
			icon: "tune",
			index: 2,
		},
		{
			key: "formatter",
			text: strings.formatter,
			icon: "stars",
		},
		{
			key: "theme",
			text: strings.theme,
			icon: "color_lenspalette",
		},
		{
			key: "backup-restore",
			text: strings.backup.capitalize() + "/" + strings.restore.capitalize(),
			icon: "cached",
		},
		{
			key: "rateapp",
			text: strings["rate acode"],
			icon: "googleplay",
		},
		{
			key: "plugins",
			text: strings["plugins"],
			icon: "extension",
		},
		{
			key: "reset",
			text: strings["restore default settings"],
			icon: "historyrestore",
			index: 6,
		},
		{
			key: "preview-settings",
			text: strings["preview settings"],
			icon: "play_arrow",
			index: 4,
		},
		{
			key: "terminal-settings",
			text: `${strings["terminal settings"]}`,
			icon: "licons terminal",
			index: 5,
		},
		{
			key: "editSettings",
			text: `${strings["edit"]} settings.json`,
			icon: "edit",
		},
		{
			key: "changeLog",
			text: `${strings["changelog"]}`,
			icon: "update",
		},
	];

	if (IS_FREE_VERSION) {
		items.push({
			key: "removeads",
			text: strings["remove ads"],
			icon: "cancel",
		});
	}

	/**
	 * Callback for settings page for handling click event
	 * @this {HTMLElement}
	 * @param {string} key
	 */
	async function callback(key) {
		switch (key) {
			case "app-settings":
			case "backup-restore":
			case "editor-settings":
			case "preview-settings":
			case "terminal-settings":
				appSettings.uiSettings[key].show();
				break;

			case "theme":
				themeSetting();
				break;

			case "about":
				About();
				break;

			case "sponsors":
				Sponsors();
				break;

			case "rateapp":
				rateBox();
				break;

			case "plugins":
				plugins();
				break;

			case "formatter":
				formatterSettings();
				break;

			case "editSettings": {
				actionStack.pop();
				openFile(settings.settingsFile);
				break;
			}

			case "reset":
				const confirmation = await confirm(
					strings.warning,
					strings["restore default settings"],
				);
				if (confirmation) {
					await appSettings.reset();
					location.reload();
				}
				break;

			case "removeads":
				try {
					await removeAds();
					this.remove();
				} catch (error) {
					helpers.error(error);
				}
				break;

			case "changeLog":
				Changelog();
				break;

			default:
				break;
		}
	}

	const page = settingsPage(title, items, callback);
	page.show();

	appSettings.uiSettings["main-settings"] = page;
	appSettings.uiSettings["app-settings"] = otherSettings();
	appSettings.uiSettings["file-settings"] = filesSettings();
	appSettings.uiSettings["backup-restore"] = backupRestore();
	appSettings.uiSettings["editor-settings"] = editorSettings();
	appSettings.uiSettings["scroll-settings"] = scrollSettings();
	appSettings.uiSettings["search-settings"] = searchSettings();
	appSettings.uiSettings["preview-settings"] = previewSettings();
	appSettings.uiSettings["terminal-settings"] = terminalSettings();
}

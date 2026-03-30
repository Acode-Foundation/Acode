import settingsPage from "components/settingsPage";
import confirm from "dialogs/confirm";
import rateBox from "dialogs/rateBox";
import actionStack from "lib/actionStack";
import openFile from "lib/openFile";
import removeAds from "lib/removeAds";
import appSettings from "lib/settings";
import settings from "lib/settings";
import openAdRewardsPage from "pages/adRewards";
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
import lspSettings from "./lspSettings";
import previewSettings from "./previewSettings";
import scrollSettings from "./scrollSettings";
import searchSettings from "./searchSettings";
import terminalSettings from "./terminalSettings";

export default function mainSettings() {
	const title = strings.settings.capitalize();
	const categories = {
		core: strings["settings-category-core"],
		customizationTools: strings["settings-category-customization-tools"],
		maintenance: strings["settings-category-maintenance"],
		aboutAcode: strings["settings-category-about-acode"],
		supportAcode: strings["settings-category-support-acode"],
	};
	const items = [
		{
			key: "app-settings",
			text: strings["app settings"],
			icon: "tune",
			info: strings["settings-info-main-app-settings"],
			category: categories.core,
			chevron: true,
		},
		{
			key: "editor-settings",
			text: strings["editor settings"],
			icon: "text_format",
			info: strings["settings-info-main-editor-settings"],
			category: categories.core,
			chevron: true,
		},
		{
			key: "terminal-settings",
			text: `${strings["terminal settings"]}`,
			icon: "terminal",
			info: strings["settings-info-main-terminal-settings"],
			category: categories.core,
			chevron: true,
		},
		{
			key: "preview-settings",
			text: strings["preview settings"],
			icon: "public",
			info: strings["settings-info-main-preview-settings"],
			category: categories.core,
			chevron: true,
		},
		{
			key: "formatter",
			text: strings.formatter,
			icon: "spellcheck",
			info: strings["settings-info-main-formatter"],
			category: categories.customizationTools,
			chevron: true,
		},
		{
			key: "theme",
			text: strings.theme,
			icon: "color_lenspalette",
			info: strings["settings-info-main-theme"],
			category: categories.customizationTools,
			chevron: true,
		},
		{
			key: "plugins",
			text: strings["plugins"],
			icon: "extension",
			info: strings["settings-info-main-plugins"],
			category: categories.customizationTools,
			chevron: true,
		},
		{
			key: "lsp-settings",
			text:
				strings?.lsp_settings ||
				strings["language servers"] ||
				"Language servers",
			icon: "zap",
			info: strings["settings-info-main-lsp-settings"],
			category: categories.customizationTools,
			chevron: true,
		},
		{
			key: "backup-restore",
			text: `${strings.backup.capitalize()} & ${strings.restore.capitalize()}`,
			icon: "cached",
			info: strings["settings-info-main-backup-restore"],
			category: categories.maintenance,
			chevron: true,
		},
		{
			key: "editSettings",
			text: `${strings["edit"]} settings.json`,
			icon: "edit",
			info: strings["settings-info-main-edit-settings"],
			category: categories.maintenance,
			chevron: true,
		},
		{
			key: "reset",
			text: strings["restore default settings"],
			icon: "historyrestore",
			info: strings["settings-info-main-reset"],
			category: categories.maintenance,
			chevron: true,
		},
		{
			key: "about",
			text: strings.about,
			icon: "info",
			info: `Version ${BuildInfo.version}`,
			category: categories.aboutAcode,
			chevron: true,
		},
		{
			key: "sponsors",
			text: strings.sponsor,
			icon: "favorite",
			info: strings["settings-info-main-sponsors"],
			category: categories.aboutAcode,
			chevron: true,
		},
		{
			key: "changeLog",
			text: `${strings["changelog"]}`,
			icon: "update",
			info: strings["settings-info-main-changelog"],
			category: categories.aboutAcode,
			chevron: true,
		},
		{
			key: "rateapp",
			text: strings["rate acode"],
			icon: "star_outline",
			info: strings["settings-info-main-rateapp"],
			category: categories.aboutAcode,
			chevron: true,
		},
	];

	if (IS_FREE_VERSION) {
		items.push({
			key: "adRewards",
			text: strings["earn ad-free time"],
			icon: "play_arrow",
			info: strings["settings-info-main-ad-rewards"],
			category: categories.supportAcode,
			chevron: true,
		});
		items.push({
			key: "removeads",
			text: strings["remove ads"],
			icon: "block",
			info: strings["settings-info-main-remove-ads"],
			category: categories.supportAcode,
			chevron: true,
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
			case "lsp-settings":
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

			case "adRewards":
				openAdRewardsPage();
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

	const page = settingsPage(title, items, callback, undefined, {
		preserveOrder: true,
		pageClassName: "main-settings-page",
		listClassName: "main-settings-list",
	});
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
	appSettings.uiSettings["lsp-settings"] = lspSettings();
}

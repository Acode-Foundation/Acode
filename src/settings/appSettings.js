import fsOperation from "fileSystem";
import ajax from "@deadlyjack/ajax";
import { resetKeyBindings } from "cm/commandRegistry";
import settingsPage from "components/settingsPage";
import loader from "dialogs/loader";
import select from "dialogs/select";
import actions from "handlers/quickTools";
import actionStack from "lib/actionStack";
import constants from "lib/constants";
import fonts from "lib/fonts";
import lang from "lib/lang";
import openFile from "lib/openFile";
import appSettings from "lib/settings";
import FontManager from "pages/fontManager";
import QuickToolsSettings from "pages/quickTools";
import encodings, { getEncoding } from "utils/encodings";
import helpers from "utils/helpers";
import Url from "utils/Url";

export default function otherSettings() {
	const values = appSettings.value;
	const title = strings["app settings"].capitalize();
	const appFontText = strings["app font"] || "App font";
	const appFontInfo =
		strings["settings-info-app-font-family"] ||
		"Choose the font used across the app interface.";
	const defaultFontLabel = strings.default || "Default";
	const categories = {
		interface: strings["settings-category-interface"],
		fonts: strings["settings-category-fonts"],
		filesSessions: strings["settings-category-files-sessions"],
		advanced: strings["settings-category-advanced"],
	};
	const items = [
		{
			key: "lang",
			text: strings["change language"],
			value: values.lang,
			select: lang.list,
			valueText: (value) => lang.getName(value),
			info: strings["settings-info-app-language"],
			category: categories.interface,
		},
		{
			key: "animation",
			text: strings.animation,
			value: values.animation,
			valueText: (value) => strings[value],
			select: [
				["no", strings.no],
				["yes", strings.yes],
				["system", strings.system],
			],
			info: strings["settings-info-app-animation"],
			category: categories.interface,
		},
		{
			key: "fullscreen",
			text: strings.fullscreen.capitalize(),
			checkbox: values.fullscreen,
			info: strings["settings-info-app-fullscreen"],
			category: categories.interface,
		},
		{
			key: "keyboardMode",
			text: strings["keyboard mode"],
			value: values.keyboardMode,
			valueText(mode) {
				return strings[mode.replace(/_/g, " ").toLocaleLowerCase()];
			},
			select: [
				[appSettings.KEYBOARD_MODE_NORMAL, strings.normal],
				[appSettings.KEYBOARD_MODE_NO_SUGGESTIONS, strings["no suggestions"]],
				[
					appSettings.KEYBOARD_MODE_NO_SUGGESTIONS_AGGRESSIVE,
					strings["no suggestions aggressive"],
				],
			],
			info: strings["settings-info-app-keyboard-mode"],
			category: categories.interface,
		},
		{
			key: "vibrateOnTap",
			text: strings["vibrate on tap"],
			checkbox: values.vibrateOnTap,
			info: strings["settings-info-app-vibrate-on-tap"],
			category: categories.interface,
		},
		{
			key: "floatingButton",
			text: strings["floating button"],
			checkbox: values.floatingButton,
			info: strings["settings-info-app-floating-button"],
			category: categories.interface,
		},
		{
			key: "showSideButtons",
			text: strings["show side buttons"],
			checkbox: values.showSideButtons,
			info: strings["settings-info-app-side-buttons"],
			category: categories.interface,
		},
		{
			key: "showSponsorSidebarApp",
			text: `${strings.sponsor} (${strings.sidebar})`,
			checkbox: values.showSponsorSidebarApp,
			info: strings["settings-info-app-sponsor-sidebar"],
			category: categories.interface,
		},
		{
			key: "openFileListPos",
			text: strings["active files"],
			value: values.openFileListPos,
			valueText: (value) => strings[value],
			select: [
				[appSettings.OPEN_FILE_LIST_POS_SIDEBAR, strings.sidebar],
				[appSettings.OPEN_FILE_LIST_POS_HEADER, strings.header],
				[appSettings.OPEN_FILE_LIST_POS_BOTTOM, strings.bottom],
			],
			info: strings["settings-info-app-open-file-list-position"],
			category: categories.interface,
		},
		{
			key: "quickTools",
			text: strings["quick tools"],
			checkbox: !!values.quickTools,
			info: strings["info-quickTools"],
			category: categories.interface,
		},
		{
			key: "quickToolsTriggerMode",
			text: strings["quicktools trigger mode"],
			value: values.quickToolsTriggerMode,
			select: [
				[appSettings.QUICKTOOLS_TRIGGER_MODE_CLICK, "click"],
				[appSettings.QUICKTOOLS_TRIGGER_MODE_TOUCH, "touch"],
			],
			info: strings["settings-info-app-quick-tools-trigger-mode"],
			category: categories.interface,
		},
		{
			key: "quickToolsSettings",
			text: strings["shortcut buttons"],
			info: strings["settings-info-app-quick-tools-settings"],
			category: categories.interface,
			chevron: true,
		},
		{
			key: "touchMoveThreshold",
			text: strings["touch move threshold"],
			value: values.touchMoveThreshold,
			prompt: strings["touch move threshold"],
			promptType: "number",
			promptOptions: {
				test(value) {
					return value >= 0;
				},
			},
			info: strings["settings-info-app-touch-move-threshold"],
			category: categories.interface,
		},
		{
			key: "appFont",
			text: appFontText,
			value: values.appFont || "",
			valueText: (value) => value || defaultFontLabel,
			get select() {
				return [["", defaultFontLabel], ...fonts.getNames()];
			},
			info: appFontInfo,
			category: categories.fonts,
		},
		{
			key: "fontManager",
			text: strings["fonts"],
			info: strings["settings-info-app-font-manager"],
			category: categories.fonts,
			chevron: true,
		},
		{
			key: "rememberFiles",
			text: strings["remember opened files"],
			checkbox: values.rememberFiles,
			info: strings["settings-info-app-remember-files"],
			category: categories.filesSessions,
		},
		{
			key: "rememberFolders",
			text: strings["remember opened folders"],
			checkbox: values.rememberFolders,
			info: strings["settings-info-app-remember-folders"],
			category: categories.filesSessions,
		},
		{
			key: "retryRemoteFsAfterFail",
			text: strings["retry ftp/sftp when fail"],
			checkbox: values.retryRemoteFsAfterFail,
			info: strings["settings-info-app-retry-remote-fs"],
			category: categories.filesSessions,
		},
		{
			key: "excludeFolders",
			text: strings["exclude files"],
			value: values.excludeFolders.join("\n"),
			prompt: strings["exclude files"],
			promptType: "textarea",
			promptOptions: {
				test(value) {
					return value.split("\n").every((item) => {
						return item.trim().length > 0;
					});
				},
			},
			info: strings["settings-info-app-exclude-folders"],
			category: categories.filesSessions,
		},
		{
			key: "defaultFileEncoding",
			text: strings["default file encoding"],
			value: values.defaultFileEncoding,
			valueText: (value) =>
				value === "auto" ? strings.auto || "Auto" : getEncoding(value).label,
			select: [
				["auto", strings.auto || "Auto"],
				...Object.keys(encodings).map((id) => {
					const encoding = encodings[id];
					return [id, encoding.label];
				}),
			],
			info: strings["settings-info-app-default-file-encoding"],
			category: categories.filesSessions,
		},
		{
			key: "keybindings",
			text: strings["key bindings"],
			info: strings["settings-info-app-keybindings"],
			category: categories.advanced,
			chevron: true,
		},
		{
			key: "confirmOnExit",
			text: strings["confirm on exit"],
			checkbox: values.confirmOnExit,
			info: strings["settings-info-app-confirm-on-exit"],
			category: categories.advanced,
		},
		{
			key: "checkFiles",
			text: strings["check file changes"],
			checkbox: values.checkFiles,
			info: strings["settings-info-app-check-files"],
			category: categories.advanced,
		},
		{
			key: "checkForAppUpdates",
			text: strings["check for app updates"],
			checkbox: values.checkForAppUpdates,
			info: strings["info-checkForAppUpdates"],
			category: categories.advanced,
		},
		{
			key: "console",
			text: strings.console,
			value: values.console,
			select: [appSettings.CONSOLE_LEGACY, appSettings.CONSOLE_ERUDA],
			info: strings["settings-info-app-console"],
			category: categories.advanced,
		},
		{
			key: "developerMode",
			text: strings["developer mode"],
			checkbox: values.developerMode,
			info: strings["info-developermode"],
			category: categories.advanced,
		},
		{
			key: "cleanInstallState",
			text: strings["clean install state"],
			info: strings["settings-info-app-clean-install-state"],
			category: categories.advanced,
			chevron: true,
		},
	];

	return settingsPage(title, items, callback, undefined, {
		preserveOrder: true,
		pageClassName: "detail-settings-page",
		listClassName: "detail-settings-list",
		infoAsDescription: true,
		valueInTail: true,
	});

	async function callback(key, value) {
		switch (key) {
			case "keybindings": {
				value = await select(strings["key bindings"], [
					["edit", strings.edit],
					["reset", strings.reset],
				]);
				if (!value) return;

				if (value === "edit") {
					actionStack.pop(2);
					openFile(KEYBINDING_FILE);
				} else {
					resetKeyBindings();
				}
				return;
			}

			case "quickToolsSettings":
				QuickToolsSettings();
				return;

			case "fontManager":
				FontManager();
				return;

			case "appFont":
				await fonts.setAppFont(value);
				break;

			case "console": {
				if (value !== "eruda") {
					break;
				}

				const fs = fsOperation(Url.join(DATA_STORAGE, "eruda.js"));
				if (await fs.exists()) {
					break;
				}

				loader.create(
					strings["downloading file"].replace("{file}", "eruda.js"),
					strings["downloading..."],
				);
				try {
					const erudaScript = await ajax({
						url: constants.ERUDA_CDN,
						responseType: "text",
						contentType: "application/x-www-form-urlencoded",
					});
					await fsOperation(DATA_STORAGE).createFile("eruda.js", erudaScript);
					loader.destroy();
				} catch (error) {
					helpers.error(error);
				}
				break;
			}

			case "developerMode": {
				if (value) {
					const devTools = (await import("lib/devTools")).default;
					try {
						await devTools.init(true);
						toast(
							strings["developer mode enabled"] ||
								"Developer mode enabled. Use command palette to toggle inspector.",
						);
					} catch (error) {
						helpers.error(error);
						value = false;
					}
				} else {
					const devTools = (await import("lib/devTools")).default;
					devTools.destroy();
					toast(
						strings["developer mode disabled"] || "Developer mode disabled",
					);
				}
				break;
			}

			case "cleanInstallState": {
				const INSTALL_STATE_STORAGE = Url.join(DATA_STORAGE, ".install-state");

				const fs = fsOperation(INSTALL_STATE_STORAGE);

				if (!(await fs.exists())) {
					toast(strings["no such file or directory"]);
					break;
				}

				loader.create("loading...");

				try {
					await fs.delete();
					loader.destroy();
					toast(strings["success"]);
				} catch (error) {
					helpers.error(error);
					loader.destroy();
				}
			}

			case "rememberFiles":
				if (!value) {
					delete localStorage.files;
				}
				break;

			case "rememberFolders":
				if (!value) {
					delete localStorage.folders;
				}
				break;

			case "floatingButton":
				root.classList.toggle("hide-floating-button");
				break;

			case "keyboardMode":
				system.setInputType(value);
				break;

			case "fullscreen":
				if (value) acode.exec("enable-fullscreen");
				else acode.exec("disable-fullscreen");
				break;

			case "quickTools":
				if (value) {
					value = 1;
					actions("set-height", 1);
				} else {
					value = 0;
					actions("set-height", 0);
				}
				break;

			case "excludeFolders":
				value = value
					.split("\n")
					.map((item) => item.trim())
					.filter((item) => item.length > 0);
				break;

			default:
				break;
		}

		appSettings.update({
			[key]: value,
		});
	}
}

import fsOperation from "fileSystem";
import ajax from "@deadlyjack/ajax";
import { resetKeyBindings } from "cm/commandRegistry";
import settingsPage from "components/settingsPage";
import loader from "dialogs/loader";
import actions from "handlers/quickTools";
import actionStack from "lib/actionStack";
import constants from "lib/constants";
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
	const items = [
		{
			key: "lang",
			text: strings["change language"],
			value: values.lang,
			select: lang.list,
			valueText: (value) => lang.getName(value),
			info: "App language and translated labels",
			category: "Interface",
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
			info: "Transition effects throughout the app",
			category: "Interface",
		},
		{
			key: "fullscreen",
			text: strings.fullscreen.capitalize(),
			checkbox: values.fullscreen,
			info: "Hide the system status bar",
			category: "Interface",
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
			info: "How the software keyboard behaves while editing",
			category: "Interface",
		},
		{
			key: "vibrateOnTap",
			text: strings["vibrate on tap"],
			checkbox: values.vibrateOnTap,
			info: "Haptic feedback on taps and controls",
			category: "Interface",
		},
		{
			key: "floatingButton",
			text: strings["floating button"],
			checkbox: values.floatingButton,
			info: "Quick action overlay",
			category: "Interface",
		},
		{
			key: "showSideButtons",
			text: strings["show side buttons"],
			checkbox: values.showSideButtons,
			info: "Show the extra side action buttons",
			category: "Interface",
		},
		{
			key: "showSponsorSidebarApp",
			text: `${strings.sponsor} (${strings.sidebar})`,
			checkbox: values.showSponsorSidebarApp,
			info: "Show the sponsor entry in the sidebar",
			category: "Interface",
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
			info: "Where the active files list appears",
			category: "Interface",
		},
		{
			key: "quickTools",
			text: strings["quick tools"],
			checkbox: !!values.quickTools,
			info: strings["info-quickTools"],
			category: "Interface",
		},
		{
			key: "quickToolsTriggerMode",
			text: strings["quicktools trigger mode"],
			value: values.quickToolsTriggerMode,
			select: [
				[appSettings.QUICKTOOLS_TRIGGER_MODE_CLICK, "click"],
				[appSettings.QUICKTOOLS_TRIGGER_MODE_TOUCH, "touch"],
			],
			info: "How quick tools open on tap or touch",
			category: "Interface",
		},
		{
			key: "quickToolsSettings",
			text: strings["shortcut buttons"],
			info: "Reorder and customise quick tool shortcuts",
			category: "Interface",
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
			info: "Minimum movement before touch drag is detected",
			category: "Interface",
		},
		{
			key: "fontManager",
			text: strings["fonts"],
			info: "Install or remove app fonts",
			category: "Fonts",
			chevron: true,
		},
		{
			key: "rememberFiles",
			text: strings["remember opened files"],
			checkbox: values.rememberFiles,
			info: "Restore the files you had open last time",
			category: "Files & sessions",
		},
		{
			key: "rememberFolders",
			text: strings["remember opened folders"],
			checkbox: values.rememberFolders,
			info: "Restore folders from the previous session",
			category: "Files & sessions",
		},
		{
			key: "retryRemoteFsAfterFail",
			text: strings["retry ftp/sftp when fail"],
			checkbox: values.retryRemoteFsAfterFail,
			info: "Retry remote file operations after a failed transfer",
			category: "Files & sessions",
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
			info: "Folders and patterns to skip while searching or scanning",
			category: "Files & sessions",
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
			info: "Default encoding when opening or creating files",
			category: "Files & sessions",
		},
		{
			key: "keybindings",
			text: strings["key bindings"],
			value: "edit",
			valueText: (value) => (value === "reset" ? strings.reset : strings.edit),
			select: [
				["edit", strings.edit],
				["reset", strings.reset],
			],
			info: "Edit the key bindings file or reset shortcuts",
			category: "Advanced",
		},
		{
			key: "confirmOnExit",
			text: strings["confirm on exit"],
			checkbox: values.confirmOnExit,
			info: "Ask before leaving the app",
			category: "Advanced",
		},
		{
			key: "checkFiles",
			text: strings["check file changes"],
			checkbox: values.checkFiles,
			info: "Detect external file changes and refresh editors",
			category: "Advanced",
		},
		{
			key: "checkForAppUpdates",
			text: strings["check for app updates"],
			checkbox: values.checkForAppUpdates,
			info: strings["info-checkForAppUpdates"],
			category: "Advanced",
		},
		{
			key: "console",
			text: strings.console,
			value: values.console,
			select: [appSettings.CONSOLE_LEGACY, appSettings.CONSOLE_ERUDA],
			info: "Which debug console integration to use",
			category: "Advanced",
		},
		{
			key: "developerMode",
			text: strings["developer mode"],
			checkbox: values.developerMode,
			info: strings["info-developermode"],
			category: "Advanced",
		},
		{
			key: "cleanInstallState",
			text: strings["clean install state"],
			info: "Clear stored install state used by onboarding and setup flows",
			category: "Advanced",
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

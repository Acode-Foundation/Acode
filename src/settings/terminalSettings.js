import fsOperation from "fileSystem";
import settingsPage from "components/settingsPage";
import {
	DEFAULT_TERMINAL_SETTINGS,
	TerminalThemeManager,
} from "components/terminal";
import toast from "components/toast";
import alert from "dialogs/alert";
import confirm from "dialogs/confirm";
import loader from "dialogs/loader";
import fonts from "lib/fonts";
import appSettings from "lib/settings";
import FileBrowser from "pages/fileBrowser";
import helpers from "utils/helpers";

export default function terminalSettings() {
	const title = strings["terminal settings"];
	const values = appSettings.value;

	// Initialize terminal settings with defaults if not present
	if (!values.terminalSettings) {
		values.terminalSettings = {
			...DEFAULT_TERMINAL_SETTINGS,
			fontFamily:
				DEFAULT_TERMINAL_SETTINGS.fontFamily || appSettings.value.fontFamily,
		};
	}

	const terminalValues = values.terminalSettings;

	const items = [
		{
			key: "all_file_access",
			text: strings.allFileAccess?.capitalize(),
			info: "Enable access of /sdcard and /storage in terminal",
		},
		{
			key: "fontSize",
			text: strings["font size"],
			value: terminalValues.fontSize,
			prompt: strings["font size"],
			promptType: "number",
			promptOptions: {
				test(value) {
					value = Number.parseInt(value);
					return value >= 8 && value <= 32;
				},
			},
			info: "The font size used to render text.",
		},
		{
			key: "fontFamily",
			text: strings["terminal:font family"],
			value: terminalValues.fontFamily,
			get select() {
				return fonts.getNames();
			},
			info: "The font family used to render text.",
		},
		{
			key: "theme",
			text: strings["theme"],
			value: terminalValues.theme,
			info: "The color theme of the terminal.",
			get select() {
				return TerminalThemeManager.getThemeNames().map((name) => [
					name,
					name.charAt(0).toUpperCase() + name.slice(1),
				]);
			},
			valueText(value) {
				const option = this.select.find(([v]) => v === value);
				return option ? option[1] : value;
			},
		},
		{
			key: "cursorStyle",
			text: strings["terminal:cursor style"],
			value: terminalValues.cursorStyle,
			select: ["block", "underline", "bar"],
			info: "The style of the cursor when the terminal is focused.",
		},
		{
			key: "cursorInactiveStyle",
			text: strings["terminal:cursor inactive style"],
			value: terminalValues.cursorInactiveStyle,
			select: ["outline", "block", "bar", "underline", "none"],
			info: "The style of the cursor when the terminal is not focused.",
		},
		{
			key: "fontWeight",
			text: strings["terminal:font weight"],
			value: terminalValues.fontWeight,
			select: [
				"normal",
				"bold",
				"100",
				"200",
				"300",
				"400",
				"500",
				"600",
				"700",
				"800",
				"900",
			],
			info: "The font weight used to render non-bold text.",
		},
		{
			key: "cursorBlink",
			text: strings["terminal:cursor blink"],
			checkbox: terminalValues.cursorBlink,
			info: "Whether the cursor blinks.",
		},
		{
			key: "scrollback",
			text: strings["terminal:scrollback"],
			value: terminalValues.scrollback,
			prompt: strings["terminal:scrollback"],
			promptType: "number",
			promptOptions: {
				test(value) {
					value = Number.parseInt(value);
					return value >= 100 && value <= 10000;
				},
			},
			info: "The amount of scrollback in the terminal. Scrollback is the amount of rows that are retained when lines are scrolled beyond the initial viewport.",
		},
		{
			key: "tabStopWidth",
			text: strings["terminal:tab stop width"],
			value: terminalValues.tabStopWidth,
			prompt: strings["terminal:tab stop width"],
			promptType: "number",
			promptOptions: {
				test(value) {
					value = Number.parseInt(value);
					return value >= 1 && value <= 8;
				},
			},
			info: "The size of tab stops in the terminal.",
		},
		{
			key: "letterSpacing",
			text: strings["letter spacing"],
			value: terminalValues.letterSpacing,
			prompt: strings["letter spacing"],
			promptType: "number",
			info: "The spacing in whole pixels between characters.",
		},
		{
			key: "convertEol",
			text: strings["terminal:convert eol"],
			checkbox: terminalValues.convertEol,
		},
		{
			key: "imageSupport",
			text: `${strings["image"]} Support`,
			checkbox: terminalValues.imageSupport,
			info: "Whether images are supported in the terminal.",
		},
		{
			key: "fontLigatures",
			text: strings["font ligatures"],
			checkbox: terminalValues.fontLigatures,
			info: "Whether font ligatures are enabled in the terminal.",
		},
		{
			key: "backup",
			text: strings.backup.capitalize(),
			info: "Creates a backup of the terminal installation",
		},
		{
			key: "restore",
			text: strings.restore.capitalize(),
			info: "Restores a backup of the terminal installation",
		},
		{
			key: "uninstall",
			text: strings.uninstall.capitalize(),
			info: "Uninstalls the terminal installation",
		},
	];

	return settingsPage(title, items, callback);

	/**
	 * Callback for settings page when an item is clicked
	 * @param {string} key
	 * @param {string} value
	 */
	async function callback(key, value) {
		switch (key) {
			case "all_file_access":
				if (ANDROID_SDK_INT >= 30) {
					system.isManageExternalStorageDeclared((boolStr) => {
						if (boolStr === "true") {
							system.requestStorageManager(console.log, console.error);
						} else {
							alert("This feature is not available.");
						}
					}, alert);
				} else {
					alert("This feature is not available.");
				}

				return;
			case "backup":
				terminalBackup();
				return;

			case "restore":
				terminalRestore();
				return;

			case "uninstall":
				const confirmation = await confirm(
					strings.confirm,
					"Are you sure you want to uninstall the terminal?",
				);
				if (confirmation) {
					loader.showTitleLoader();
					Terminal.uninstall()
						.then(() => {
							loader.removeTitleLoader();
							alert(
								strings.success.toUpperCase(),
								"Terminal uninstalled successfully.",
							);
						})
						.catch((error) => {
							loader.removeTitleLoader();
							console.error("Terminal uninstall failed:", error);
							helpers.error(error);
						});
				}
				return;

			default:
				appSettings.update({
					terminalSettings: {
						...values.terminalSettings,
						[key]: value,
					},
				});

				// Update any active terminal instances
				updateActiveTerminals(key, value);
				break;
		}
	}

	/**
	 * Creates a backup of the terminal installation
	 */
	async function terminalBackup() {
		try {
			// Ask user to select backup location
			const { url } = await FileBrowser("folder", strings["select folder"]);

			loader.showTitleLoader();

			// Create backup
			const backupPath = await Terminal.backup();
			await system.copyToUri(
				backupPath,
				url,
				"aterm_backup.tar",
				console.log,
				console.error,
			);
			loader.removeTitleLoader();
			alert(strings.success.toUpperCase(), `${strings["backup successful"]}.`);
		} catch (error) {
			loader.removeTitleLoader();
			console.error("Terminal backup failed:", error);
			toast(error.toString());
		}
	}

	/**
	 * Restores terminal installation
	 */
	async function terminalRestore() {
		try {
			sdcard.openDocumentFile(
				async (data) => {
					loader.showTitleLoader();
					//this will create a file at $PREFIX/atem_backup.bin
					await system.copyToUri(
						data.uri,
						cordova.file.dataDirectory,
						"aterm_backup",
						console.log,
						console.error,
					);

					// Restore
					await Terminal.restore();

					// Clean up
					const backupFilename = "aterm_backup.bin";
					const tempBackupPath = cordova.file.dataDirectory + backupFilename;
					const tempFS = fsOperation(tempBackupPath);
					await tempFS.delete();
					loader.removeTitleLoader();
					alert(
						strings.success.toUpperCase(),
						"Terminal restored successfully",
					);
				},
				toast,
				"application/x-tar",
			);
		} catch (error) {
			loader.removeTitleLoader();
			console.error("Terminal restore failed:", error);
			toast(error.toString());
		}
	}
}

/**
 * Update active terminal instances with new settings
 * @param {string} key
 * @param {any} value
 */
async function updateActiveTerminals(key, value) {
	// Find all terminal tabs and update their settings
	const terminalTabs = editorManager.files.filter(
		(file) => file.type === "terminal",
	);

	terminalTabs.forEach(async (tab) => {
		if (tab.terminalComponent) {
			const terminalOptions = {};

			switch (key) {
				case "fontSize":
					tab.terminalComponent.terminal.options.fontSize = value;
					break;
				case "fontFamily":
					// Load font if it's not already loaded
					try {
						await fonts.loadFont(value);
					} catch (error) {
						console.warn(`Failed to load font ${value}:`, error);
					}
					tab.terminalComponent.terminal.options.fontFamily = value;
					tab.terminalComponent.terminal.refresh(
						0,
						tab.terminalComponent.terminal.rows - 1,
					);
					break;
				case "fontWeight":
					tab.terminalComponent.terminal.options.fontWeight = value;
					break;
				case "cursorBlink":
					tab.terminalComponent.terminal.options.cursorBlink = value;
					break;
				case "cursorStyle":
					tab.terminalComponent.terminal.options.cursorStyle = value;
					break;
				case "cursorInactiveStyle":
					tab.terminalComponent.terminal.options.cursorInactiveStyle = value;
					break;
				case "scrollback":
					tab.terminalComponent.terminal.options.scrollback = value;
					break;
				case "tabStopWidth":
					tab.terminalComponent.terminal.options.tabStopWidth = value;
					break;
				case "convertEol":
					tab.terminalComponent.terminal.options.convertEol = value;
					break;
				case "letterSpacing":
					tab.terminalComponent.terminal.options.letterSpacing = value;
					break;
				case "theme":
					tab.terminalComponent.terminal.options.theme =
						TerminalThemeManager.getTheme(value);
					// Update container background to match new theme
					if (tab.terminalComponent.container) {
						tab.terminalComponent.container.style.background =
							tab.terminalComponent.terminal.options.theme.background;
					}
					break;
				case "imageSupport":
					tab.terminalComponent.updateImageSupport(value);
					break;
				case "fontLigatures":
					tab.terminalComponent.updateFontLigatures(value);
					break;
			}
		}
	});
}

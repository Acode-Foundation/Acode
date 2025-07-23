import fsOperation from "fileSystem";
import ThemeBuilder from "theme/builder";
import themes from "theme/list";
import { getSystemEditorTheme } from "theme/preInstalled";
import helpers from "utils/helpers";
import Url from "utils/Url";
import constants from "./constants";
import lang from "./lang";
import { isDeviceDarkTheme } from "./systemConfiguration";

/**
 * @typedef {object} fileBrowserSettings
 * @property {string} showHiddenFiles
 * @property {string} sortByName
 */

/**
 * @typedef {object} searchAndFindSettings
 * @property {boolean} wrap
 * @property {boolean} caseSensitive
 * @property {boolean} regExp
 */

class Settings {
	#customTheme = new ThemeBuilder("Custom").toJSON();
	#defaultSettings;
	#oldSettings;
	#initialized = false;
	#on = {
		update: [],
		"update:after": [],
		reset: [],
	};
	#searchSettings = {
		caseSensitive: false,
		regExp: false,
		wholeWord: false,
	};
	#fileBrowserSettings = {
		showHiddenFiles: false,
		sortByName: true,
	};
	#excludeFolders = [
		"**/node_modules/**",
		"**/bower_components/**",
		"**/jspm_packages/**",
		"**/.npm/**",
		"**/flow-typed/**",
		"**/vendor/**",
		"**/composer/**",
		"**/venv/**",
		"**/.virtualenv/**",
		"**/__pycache__/**",
		"**/.pytest_cache/**",
		"**/.eggs/**",
		"**/*.egg-info/**",
		"**/.git/**",
		"**/.svn/**",
		"**/.hg/**",
		"**/.vscode/**",
		"**/.idea/**",
		"**/.vs/**",
		"**/.project/**",
		"**/.settings/**",
		"**/.classpath/**",
		"**/dist/**",
		"**/build/**",
		"**/out/**",
		"**/target/**",
		"**/bin/**",
		"**/obj/**",
		"**/coverage/**",
		"**/.nyc_output/**",
		"**/htmlcov/**",
		"**/temp/**",
		"**/tmp/**",
		"**/.cache/**",
		"**/logs/**",
		"**/.sass-cache/**",
		"**/.DS_Store/**",
		"**/Thumbs.db/**",
	];
	#IS_TABLET = innerWidth > 768;

	QUICKTOOLS_ROWS = 2;
	QUICKTOOLS_GROUP_CAPACITY = 8;
	QUICKTOOLS_GROUPS = 2;
	#QUICKTOOLS_SIZE =
		this.QUICKTOOLS_GROUP_CAPACITY * // items per group
		this.QUICKTOOLS_GROUPS * // number of groups
		this.QUICKTOOLS_ROWS; // number of rows

	QUICKTOOLS_TRIGGER_MODE_TOUCH = "touch";
	QUICKTOOLS_TRIGGER_MODE_CLICK = "click";
	OPEN_FILE_LIST_POS_HEADER = "header";
	OPEN_FILE_LIST_POS_SIDEBAR = "sidebar";
	OPEN_FILE_LIST_POS_BOTTOM = "bottom";
	KEYBOARD_MODE_NO_SUGGESTIONS = "NO_SUGGESTIONS";
	KEYBOARD_MODE_NO_SUGGESTIONS_AGGRESSIVE = "NO_SUGGESTIONS_AGGRESSIVE";
	KEYBOARD_MODE_NORMAL = "NORMAL";
	CONSOLE_ERUDA = "eruda";
	CONSOLE_LEGACY = "legacy";
	PREVIEW_MODE_INAPP = "inapp";
	PREVIEW_MODE_BROWSER = "browser";

	/**@type {{[key: string]: import('components/settingsPage').SettingsPage}} */
	uiSettings = {};

	constructor() {
		this.#defaultSettings = {
			animation: "system",
			appTheme: "dark",
			autosave: 0,
			fileBrowser: this.#fileBrowserSettings,
			formatter: {},
			maxFileSize: 12,
			serverPort: constants.SERVER_PORT,
			previewPort: constants.PREVIEW_PORT,
			showConsoleToggler: true,
			previewMode: this.PREVIEW_MODE_INAPP,
			disableCache: false,
			useCurrentFileForPreview: false,
			host: "localhost",
			search: this.#searchSettings,
			lang: "en-us",
			fontSize: "12px",
			editorTheme: "ace/theme/nord_dark",
			textWrap: true,
			softTab: true,
			tabSize: 2,
			retryRemoteFsAfterFail: true,
			linenumbers: true,
			formatOnSave: false,
			fadeFoldWidgets: false,
			autoCorrect: true,
			openFileListPos: this.OPEN_FILE_LIST_POS_HEADER,
			quickTools: this.#IS_TABLET ? 0 : 1,
			quickToolsTriggerMode: this.QUICKTOOLS_TRIGGER_MODE_TOUCH,
			editorFont: "Roboto Mono",
			vibrateOnTap: true,
			fullscreen: false,
			floatingButton: !this.#IS_TABLET,
			liveAutoCompletion: true,
			showPrintMargin: false,
			printMargin: 80,
			scrollbarSize: 20,
			showSpaces: false,
			confirmOnExit: true,
			lineHeight: 2,
			leftMargin: 50,
			checkFiles: true,
			desktopMode: false,
			console: this.CONSOLE_LEGACY,
			keyboardMode: this.KEYBOARD_MODE_NO_SUGGESTIONS_AGGRESSIVE,
			rememberFiles: true,
			rememberFolders: true,
			diagonalScrolling: false,
			reverseScrolling: false,
			teardropTimeout: 3000,
			teardropSize: 30,
			scrollSpeed: constants.SCROLL_SPEED_NORMAL,
			customTheme: this.#customTheme,
			relativeLineNumbers: false,
			elasticTabstops: false,
			rtlText: false,
			hardWrap: false,
			useTextareaForIME: false,
			touchMoveThreshold: Math.round((1 / devicePixelRatio) * 10) / 20,
			quicktoolsItems: [...Array(this.#QUICKTOOLS_SIZE).keys()],
			excludeFolders: this.#excludeFolders,
			defaultFileEncoding: "UTF-8",
			inlineAutoCompletion: true,
			colorPreview: true,
			maxRetryCount: 3,
			showRetryToast: false,
			showSideButtons: true,
			showAnnotations: false,
			pluginsDisabled: {}, // pluginId: true/false
		};
		this.value = structuredClone(this.#defaultSettings);
	}

	async init() {
		if (this.#initialized) return;
		this.settingsFile = Url.join(DATA_STORAGE, "settings.json");

		if (!IS_FREE_VERSION) {
			this.#defaultSettings.appTheme = "system";
			this.#defaultSettings.editorTheme = getSystemEditorTheme(
				isDeviceDarkTheme(),
			);
		}

		this.#initialized = true;

		const fs = fsOperation(this.settingsFile);

		if (!(await fs.exists())) {
			await this.#save();
			this.value = structuredClone(this.#defaultSettings);
			this.#oldSettings = structuredClone(this.#defaultSettings);
			this.value.lang = navigator.language || "en-us";
			return;
		}

		const settings = helpers.parseJSON(await fs.readFile("utf8"));
		if (settings) {
			// make sure that all the settings are present
			Object.keys(this.#defaultSettings).forEach((setting) => {
				const value = settings[setting];
				if (
					value === undefined ||
					typeof value !== typeof this.#defaultSettings[setting]
				) {
					settings[setting] = this.#defaultSettings[setting];
				}
			});

			this.value = structuredClone(settings);
			this.#oldSettings = structuredClone(settings);
			try {
				themes.update(ThemeBuilder.fromJSON(this.value.customTheme));
			} catch (error) {
				themes.update(new ThemeBuilder("Custom").toJSON());
			}

			// Ensure pluginsDisabled exists
			if (!this.value.pluginsDisabled) this.value.pluginsDisabled = {};

			return;
		}

		await this.reset();
	}

	async #save() {
		const fs = fsOperation(this.settingsFile);
		const settingsText = JSON.stringify(this.value, undefined, 4);

		if (!(await fs.exists())) {
			const dirFs = fsOperation(DATA_STORAGE);
			await dirFs.createFile("settings.json");
		}

		await fs.writeFile(settingsText);
		this.#oldSettings = structuredClone(this.value);
	}

	/**
	 *
	 * @param {Object} [settings] - if provided, the settings will be updated
	 * @param {Boolean} [showToast] - if false, the toast will not be shown
	 * default is true
	 * @param {Boolean} [saveFile] - if false, the settings will not be saved to the file,
	 * default is true
	 */
	async update(settings, showToast = true, saveFile = true) {
		if (typeof settings === "boolean") {
			showToast = settings;
			settings = undefined;
		}

		const onupdate = [...this.#on.update];
		const onupdateAfter = [...this.#on["update:after"]];

		if (settings) {
			Object.keys(settings).forEach((key) => {
				if (key in this.value) this.value[key] = settings[key];
			});
		}

		const changedSettings = this.#getChangedKeys();
		changedSettings.forEach((setting) => {
			this.#applySettings(setting);
			const listeners = this.#on[`update:${setting}`];
			if (Array.isArray(listeners)) {
				onupdate.push(...listeners);
			}
			onupdate.forEach((listener) => listener(this.value[setting]));
		});

		if (saveFile) await this.#save();
		if (showToast) toast(strings["settings saved"]);

		changedSettings.forEach((setting) => {
			const listeners = this.#on[`update:${setting}:after`];
			if (Array.isArray(listeners)) {
				onupdateAfter.push(...listeners);
			}
			onupdateAfter.forEach((listener) => listener(this.value[setting]));
		});
	}

	async reset(setting) {
		if (setting) {
			if (setting in this.#defaultSettings) {
				this.value[setting] = this.#defaultSettings[setting];
				await this.update();
			} else {
				return false;
			}
		} else {
			this.value = this.#defaultSettings;
			await this.update(false);
		}

		this.#on.reset.forEach((onreset) => onreset(this.value));
	}

	/**
	 * Adds a listener for the given event
	 * @param {'update:<setting>' | 'update:<setting>:after' | 'reset'} event
	 * @param {function():void} callback
	 */
	on(event, callback) {
		if (!this.#on[event]) this.#on[event] = [];
		this.#on[event].push(callback);
	}

	/**
	 * Removes the given callback from the given event
	 * @param {'update' | 'reset'} event
	 * @param {function():void} callback
	 */
	off(event, callback) {
		if (!this.#on[event]) this.#on[event] = [];
		this.#on[event].splice(this.#on[event].indexOf(callback), 1);
	}

	/**
	 * Gets a setting with the given key
	 * @param {String} key
	 * @returns
	 */
	get(key) {
		return this.value[key];
	}

	/**
	 * Returns changed settings
	 * @returns {Array<String>}
	 */
	#getChangedKeys() {
		if (!this.#oldSettings) return [];
		const keys = [];
		Object.keys(this.#oldSettings).forEach((key) => {
			const value = this.#oldSettings[key];
			if (typeof value === "object") {
				if (!areEqual(value, this.value[key])) keys.push(key);
				return;
			}

			if (value !== this.value[key]) keys.push(key);
		});
		return keys;
	}

	#applySettings(setting) {
		switch (setting) {
			case "animation":
				this.applyAnimationSetting();
				break;

			case "lang":
				this.applyLangSetting();
				break;

			default:
				break;
		}
	}

	async applyAnimationSetting() {
		let value = this.value.animation;
		if (value === "system") {
			const res = await new Promise((resolve, reject) => {
				system.getGlobalSetting("animator_duration_scale", resolve, reject);
			});
			if (res) value = "yes";
			else value = "no";
		}

		if (value === "yes") {
			app.classList.remove("no-animation");
		} else if (value === "no") {
			app.classList.add("no-animation");
		}
	}

	async applyLangSetting() {
		const value = this.value.lang;
		lang.set(value);
	}
}

/**
 * Checks whether given objects are equal or not
 * @param {Object} obj1
 * @param {Object} obj2
 * @returns
 */
function areEqual(obj1, obj2) {
	if (obj1 === obj2) return true;
	if (obj1 == null || obj2 == null) return false;
	if (obj1.constructor !== obj2.constructor) return false;

	for (let key in obj1) {
		if (!obj2.hasOwnProperty(key)) return false;
		if (obj1[key] === obj2[key]) continue;
		if (typeof obj1[key] !== "object") return false;
		if (!areEqual(obj1[key], obj2[key])) return false;
	}

	return true;
}

export default new Settings();

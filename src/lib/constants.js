export default {
  FILE_NAME_REGEX: /^((?![:<>"\/\\\|\?\*]).)*$/,
  FONT_SIZE: /^[0-9]{1,2}(px|em|pt|mm|pc|in)$/,
  HEX_COLOR: /^#([a-f0-9]{3}){1,2}([a-f0-9]{2})?$/i,
  RGB_COLOR: /^rgba?\((\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(\s*,\s*\d?(\.\d+)?)?\)$/i,
  HSL_COLOR: /^hsla?\(([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%(\s*,\s*\d?(\.\d+)?)?\)$/i,
  DEFAULT_SESSION: "default-session",
  DEFAULT_FILE_NAME: "untitled.txt",
  RATING_TIME: 15,
  CONSOLE_PORT: 8159,
  PORT: 8158,
  VIBRATION_TIME: 30,
  BACKUP_FILE: 'backups/Acode/backup',
  PAYPAL: "https://paypal.me/deadlyjack",
  PATREON: "https://patreon.com/foxdebug",
  PAID_VERSION: "https://play.google.com/store/apps/details?id=com.foxdebug.acode",
  FEEDBACK_EMAIL: "acode@foxdebug.com",
  PERSONAL_EMAIL: "ajit@foxdebug.com",
  notification: {
    EXIT_FULL_SCREEN: 1,
    SUPPORT_ACODE: 2
  },
  COMMANDS: ["saveFile", "saveFileAs", "newFile", "nextFile", "prevFile", "openFile", "run", "find", "replace", "toggleSidebar", "toggleFullscreen", "toggleMenu", "toggleEditMenu"],
  encodings: [
    "utf-8",
    "ibm866",
    "iso-8859-2",
    "iso-8859-3",
    "iso-8859-4",
    "iso-8859-5",
    "iso-8859-6",
    "iso-8859-7",
    "iso-8859-8",
    "iso-8859-8i",
    "iso-8859-10",
    "iso-8859-13",
    "iso-8859-14",
    "iso-8859-15",
    "iso-8859-16",
    "koi8-r",
    "koi8-u",
    "macintosh",
    "windows-874",
    "windows-1250",
    "windows-1251",
    "windows-1252",
    "windows-1253",
    "windows-1254",
    "windows-1255",
    "windows-1256",
    "windows-1257",
    "windows-1258",
    "x-mac-cyrillic",
    "gbk",
    "gb18030",
    "hz-gb-2312",
    "big5",
    "euc-jp",
    "iso-2022-jp",
    "shift-jis",
    "euc-kr",
    "iso-2022-kr",
    "utf-16be",
    "utf-16le",
    "x-user-defined",
    "replacement"
  ],
  langList: {
    "en-us": "English",
    "es-sv": "Español",
    "fr-fr": "Francais",
    "id-id": "Indonesian",
    "uz-uz": "O'zbekcha",
    "ru-ru": "Русский",
    "pt-br": "Português",
    "tr-tr": "Türkçe",
    "uk-ua": "Українська",
    "hi-in": "हिंदी",
    "zh-cn": "中文简体",
    "zh-hant": "中文繁體",
    "ir-fa": "فارسی",
    "ar-ye": "العربية",
    "ja-jp": "日本語",
    "bn-bd": "বাংলা"
  },
  themeList: {
    dark: ["ambiance", "chaos", "clouds_midnight", "cobalt", "dracula", "gob", "gruvbox", "idle_fingers", "kr_theme", "merbivore", "merbivore_soft", "mono_industrial", "monokai", "nord_dark", "pastel_on_dark", "solarized_dark", "terminal", "tomorrow_night", "tomorrow_night_blue", "tomorrow_night_bright", "tomorrow_night_eighties", "twilight", "vibrant_ink"],
    light: ["chrome", "clouds", "crimson_editor", "dawn", "dreamweaver", "eclipse", "github", "iplastic", "katzenmilch", "kuroir", "solarized_light", "sqlserver", "textmate", "tomorrow", "xcode"]
  },

  /**
   * @type {AppThemeList}
   */
  appThemeList: {
    "default": scheme("default", "light", true, "#5c5c99", "#9999ff"),
    "light": scheme("light", "light", false, "#999999", "#ffffff"),
    "atticus": scheme("atticus", "dark", false, "#201e1e", "#363333"),
    "bump": scheme("bump", "dark", false, "#1c2126", "#303841"),
    "bling": scheme("bling", "dark", false, "#131326", "#202040"),
    "dark": scheme("dark", "dark", false, "#1d1d1d", "#313131"),
    "moon": scheme("moon", "dark", false, "#14181d", "#222831"),
    "ocean": scheme("ocean", "dark", false, "#13131a", "#20202c"),
    "tomyris": scheme("tomyris", "dark", false, "#230528", "#3b0944"),
    "menes": scheme("menes", "dark", false, "#1f2226", "#353941")
  },
};

/**
 * 
 * @param {string} type 
 * @param {"light"|"dark"} type 
 * @param {boolean} isFree 
 * @param {string} darkenMode 
 * @param {string} primary 
 * @returns {ThemeData}
 */
function scheme(name, type, isFree, darkenMode, primary) {
  return {
    name,
    type,
    isFree,
    darken: darkenMode,
    primary
  };
}
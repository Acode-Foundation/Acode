const BASE_URL = "https://acode.app";
let hasPro = false;

const config = {
	BASE_URL,
	SUPPORTED_EDITOR: "cm",
	FILE_NAME_REGEX: /^((?![:<>"\\\|\?\*]).)*$/,
	FONT_SIZE: /^[0-9\.]{1,3}(px|rem|em|pt|mm|pc|in)$/,
	DEFAULT_FILE_SESSION: "default-session",
	DEFAULT_FILE_NAME: "untitled.txt",
	CONSOLE_PORT: 8159,
	SERVER_PORT: 8158,
	PREVIEW_PORT: 8158,
	VIBRATION_TIME: 30,
	VIBRATION_TIME_LONG: 150,
	SCROLL_SPEED_FAST_X2: "FAST_X2",
	SCROLL_SPEED_NORMAL: "NORMAL",
	SCROLL_SPEED_FAST: "FAST",
	SCROLL_SPEED_SLOW: "SLOW",
	SIDEBAR_SLIDE_START_THRESHOLD_PX: 20,
	CUSTOM_THEME: 'body[theme="custom"]',
	FEEDBACK_EMAIL: "acode@foxdebug.com",
	ERUDA_CDN: "https://cdn.jsdelivr.net/npm/eruda",

	get PLAY_STORE_URL() {
		return `https://play.google.com/store/apps/details?id=${BuildInfo.packageName}`;
	},

	API_BASE: `${BASE_URL}/api`,
	SKU_LIST: ["crystal", "bronze", "silver", "gold", "platinum", "titanium"],
	LOG_FILE_NAME: "Acode.log",

	// Social Links
	DOCS_URL: "https://docs.acode.app",
	GITHUB_URL: "https://github.com/Acode-Foundation/Acode",
	TELEGRAM_URL: "https://t.me/foxdebug_acode",
	DISCORD_URL: "https://discord.gg/nDqZsh7Rqz",
	TWITTER_URL: "https://x.com/foxbiz_io",
	INSTAGRAM_URL: "https://www.instagram.com/foxbiz.io/",
	FOXBIZ_URL: "https://foxbiz.io",

	get HAS_PRO() {
		return hasPro;
	},

	set HAS_PRO(value) {
		hasPro = value;
	},
};

export default config;

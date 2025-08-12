export default {
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
	API_BASE: "https://acode.app/api",
	// API_BASE: 'https://192.168.0.102:3001/api', // test api
	SKU_LIST: ["crystal", "bronze", "silver", "gold", "platinum", "titanium"],
	LOG_FILE_NAME: "Acode.log",
};

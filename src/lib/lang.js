const langMap = {
	"en-us": {
		name: "English",
		async strings() {
			return await import("../lang/en-us.json");
		},
	},
	"es-sv": {
		name: "Español",
		async strings() {
			return await import("../lang/es-sv.json");
		},
	},
	"fr-fr": {
		name: "Francais",
		async strings() {
			return await import("../lang/fr-fr.json");
		},
	},
	"tl-ph": {
		name: "Tagalog",
		async strings() {
			return await import("../lang/tl-ph.json");
		},
	},
	"de-de": {
		name: "Deutsch",
		async strings() {
			return await import("../lang/de-de.json");
		},
	},
	"id-id": {
		name: "Indonesian",
		async strings() {
			return await import("../lang/id-id.json");
		},
	},
	"uz-uz": {
		name: "O'zbekcha",
		async strings() {
			return await import("../lang/uz-uz.json");
		},
	},
	"ru-ru": {
		name: "Русский",
		async strings() {
			return await import("../lang/ru-ru.json");
		},
	},
	"pl-pl": {
		name: "Polski",
		async strings() {
			return await import("../lang/pl-pl.json");
		},
	},
	"pt-br": {
		name: "Português",
		async strings() {
			return await import("../lang/pt-br.json");
		},
	},
	"pu-in": {
		name: "ਪੰਜਾਬੀ",
		async strings() {
			return await import("../lang/pu-in.json");
		},
	},
	"tr-tr": {
		name: "Türkçe",
		async strings() {
			return await import("../lang/tr-tr.json");
		},
	},
	"uk-ua": {
		name: "Українська",
		async strings() {
			return await import("../lang/uk-ua.json");
		},
	},
	"hi-in": {
		name: "हिंदी",
		async strings() {
			return await import("../lang/hi-in.json");
		},
	},
	"zh-cn": {
		name: "中文简体",
		async strings() {
			return await import("../lang/zh-cn.json");
		},
	},
	"zh-hant": {
		name: "繁體中文",
		async strings() {
			return await import("../lang/zh-hant.json");
		},
	},
	"zh-tw": {
		name: "繁體中文 (台灣)",
		async strings() {
			return await import("../lang/zh-tw.json");
		},
	},
	"ir-fa": {
		name: "فارسی",
		async strings() {
			return await import("../lang/ir-fa.json");
		},
	},
	"ar-ye": {
		name: "العربية",
		async strings() {
			return await import("../lang/ar-ye.json");
		},
	},
	"ja-jp": {
		name: "日本語",
		async strings() {
			return await import("../lang/ja-jp.json");
		},
	},
	"bn-bd": {
		name: "বাংলা",
		async strings() {
			return await import("../lang/bn-bd.json");
		},
	},
	"cs-cz": {
		name: "Čeština",
		async strings() {
			return await import("../lang/cs-cz.json");
		},
	},
	"vi-vn": {
		name: "Tiếng Việt",
		async strings() {
			return await import("../lang/vi-vn.json");
		},
	},
	"be-by": {
		name: "Беларуская",
		async strings() {
			return await import("../lang/be-by.json");
		},
	},
	"hu-hu": {
		name: "Magyar",
		async strings() {
			return await import("../lang/hu-hu.json");
		},
	},
	"ml-in": {
		name: "മലയാളം",
		async strings() {
			return await import("../lang/ml-in.json");
		},
	},
	"mm-unicode": {
		name: "ဗမာစာ(Unicode)",
		async strings() {
			return await import("../lang/mm-unicode.json");
		},
	},
	"mm-zawgyi": {
		name: "ဗမာစာ(Zawgyi)",
		async strings() {
			return await import("../lang/mm-zawgyi.json");
		},
	},
	"ko-kr": {
		name: "한국어",
		async strings() {
			return await import("../lang/ko-kr.json");
		},
	},
	"it-it": {
		name: "Italiano",
		async strings() {
			return await import("../lang/it-it.json");
		},
	},
	"he-il": {
		name: "Hebrew",
		async strings() {
			return await import("../lang/he-il.json");
		},
	},
};

export default {
	async set(code) {
		code = code?.toLowerCase();
		const lang = langMap[code] || langMap["en-us"];
		const strings = await lang.strings();
		window.strings = strings.default;
	},
	list: Object.keys(langMap).map((code) => [code, langMap[code].name]),
	getName(code) {
		code = code?.toLowerCase();
		code = code in langMap ? code : "en-us";
		return langMap[code].name;
	},
};

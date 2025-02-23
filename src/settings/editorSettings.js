import settingsPage from "components/settingsPage";
import constants from "lib/constants";
import fonts from "lib/fonts";
import appSettings from "lib/settings";
import scrollSettings from "./scrollSettings";

export default function editorSettings() {
	const title = strings["editor settings"];
	const values = appSettings.value;
	const items = [
		{
			key: "autosave",
			text: strings.autosave.capitalize(),
			value: values.autosave,
			valueText: (value) => (value ? value : strings.no),
			prompt: strings.delay + " (>=1000 || 0)",
			promptType: "number",
			promptOptions: {
				test(value) {
					value = Number.parseInt(value);
					return value >= 1000 || value === 0;
				},
			},
		},
		{
			key: "fontSize",
			text: strings["font size"],
			value: values.fontSize,
			prompt: strings["font size"],
			promptOptions: {
				required: true,
				match: constants.FONT_SIZE,
			},
		},
		{
			key: "softTab",
			text: strings["soft tab"],
			checkbox: values.softTab,
		},
		{
			key: "tabSize",
			text: strings["tab size"],
			value: values.tabSize,
			prompt: strings["tab size"],
			promptType: "number",
			promptOptions: {
				test(value) {
					value = Number.parseInt(value);
					return value >= 1 && value <= 8;
				},
			},
		},
		{
			key: "linenumbers",
			text: strings["show line numbers"],
			checkbox: values.linenumbers,
		},
		{
			key: "lineHeight",
			text: strings["line height"],
			value: values.lineHeight,
			prompt: strings["line height"],
			promptType: "number",
			promptOptions: {
				test(value) {
					value = Number.parseFloat(value);
					return value >= 1 && value <= 2;
				},
			},
		},
		{
			key: "formatOnSave",
			text: strings["format on save"],
			checkbox: values.formatOnSave,
		},
		{
			key: "showSpaces",
			text: strings["show spaces"],
			checkbox: values.showSpaces,
		},
		{
			key: "editorFont",
			text: strings["editor font"],
			value: values.editorFont,
			get select() {
				return fonts.getNames();
			},
		},
		{
			key: "liveAutoCompletion",
			text: strings["live autocompletion"].capitalize(),
			checkbox: values.liveAutoCompletion,
		},
		{
			key: "showPrintMargin",
			text: strings["show print margin"].capitalize(),
			checkbox: values.showPrintMargin,
		},
		{
			key: "printMargin",
			text: strings["print margin"],
			value: values.printMargin,
			prompt: strings["print margin"],
			promptType: "number",
			promptOptions: {
				test(value) {
					value = Number.parseInt(value);
					return value >= 10 && value <= 200;
				},
			},
		},
		{
			key: "teardropSize",
			text: strings["cursor controller size"],
			value: values.teardropSize,
			valueText(value) {
				return this.select.find(([v]) => v === value)[1];
			},
			select: [
				[0, strings.none],
				[20, strings.small],
				[30, strings.medium],
				[60, strings.large],
			],
		},
		{
			key: "relativeLineNumbers",
			text: strings["relative line numbers"],
			checkbox: values.relativeLineNumbers,
		},
		{
			key: "elasticTabstops",
			text: strings["elastic tabstops"],
			checkbox: values.elasticTabstops,
		},
		{
			key: "rtlText",
			text: strings["line based rtl switching"],
			checkbox: values.rtlText,
		},
		{
			key: "hardWrap",
			text: strings["hard wrap"],
			checkbox: values.hardWrap,
		},
		{
			key: "useTextareaForIME",
			text: strings["use textarea for ime"],
			checkbox: values.useTextareaForIME,
		},
		{
			key: "fadeFoldWidgets",
			text: strings["fade fold widgets"],
			checkbox: values.fadeFoldWidgets,
		},
		{
			index: 0,
			key: "scroll-settings",
			text: strings["scroll settings"],
		},
		{
			key: "colorPreview",
			text: strings["color preview"],
			checkbox: values.colorPreview,
		},
	];

	return settingsPage(title, items, callback);

	/**
	 * Callback for settings page when an item is clicked
	 * @param {string} key
	 * @param {string} value
	 */
	function callback(key, value) {
		switch (key) {
			case "scroll-settings":
				appSettings.uiSettings[key].show();
				break;

			case "editorFont":
				fonts.setFont(value);

			default:
				appSettings.update({
					[key]: value,
				});
				break;
		}
	}
}

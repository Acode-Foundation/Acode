import settingsPage from "components/settingsPage";
import constants from "lib/constants";
import fonts from "lib/fonts";
import appSettings from "lib/settings";
import scrollSettings from "./scrollSettings";

export default function editorSettings() {
	const title = strings["editor settings"];
	const values = appSettings.value;
	const categories = {
		scrolling: strings["settings-category-scrolling"],
		textLayout: strings["settings-category-text-layout"],
		editing: strings["settings-category-editing"],
		assistance: strings["settings-category-assistance"],
		guidesIndicators: strings["settings-category-guides-indicators"],
		cursorSelection: strings["settings-category-cursor-selection"],
	};
	const items = [
		{
			key: "scroll-settings",
			text: strings["scroll settings"],
			info: strings["settings-info-editor-scroll-settings"],
			category: categories.scrolling,
			chevron: true,
		},
		{
			key: "editorFont",
			text: strings["editor font"],
			value: values.editorFont,
			get select() {
				return fonts.getNames();
			},
			info: strings["settings-info-editor-font-family"],
			category: categories.textLayout,
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
			info: strings["settings-info-editor-font-size"],
			category: categories.textLayout,
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
			info: strings["settings-info-editor-line-height"],
			category: categories.textLayout,
		},
		{
			key: "textWrap",
			text: strings["text wrap"],
			checkbox: values.textWrap,
			info: strings["settings-info-editor-text-wrap"],
			category: categories.textLayout,
		},
		{
			key: "hardWrap",
			text: strings["hard wrap"],
			checkbox: values.hardWrap,
			info: strings["settings-info-editor-hard-wrap"],
			category: categories.textLayout,
		},
		{
			key: "autosave",
			text: strings.autosave,
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
			info: strings["settings-info-editor-autosave"],
			category: categories.editing,
		},
		{
			key: "softTab",
			text: strings["soft tab"],
			checkbox: values.softTab,
			info: strings["settings-info-editor-soft-tab"],
			category: categories.editing,
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
			info: strings["settings-info-editor-tab-size"],
			category: categories.editing,
		},
		{
			key: "formatOnSave",
			text: strings["format on save"],
			checkbox: values.formatOnSave,
			info: strings["settings-info-editor-format-on-save"],
			category: categories.editing,
		},
		{
			key: "liveAutoCompletion",
			text: strings["live autocompletion"],
			checkbox: values.liveAutoCompletion,
			info: strings["settings-info-editor-live-autocomplete"],
			category: categories.assistance,
		},
		{
			key: "colorPreview",
			text: strings["color preview"],
			checkbox: values.colorPreview,
			info: strings["settings-info-editor-color-preview"],
			category: categories.assistance,
		},
		{
			key: "linenumbers",
			text: strings["show line numbers"],
			checkbox: values.linenumbers,
			info: strings["settings-info-editor-line-numbers"],
			category: categories.guidesIndicators,
		},
		{
			key: "relativeLineNumbers",
			text: strings["relative line numbers"],
			checkbox: values.relativeLineNumbers,
			info: strings["settings-info-editor-relative-line-numbers"],
			category: categories.guidesIndicators,
		},
		{
			key: "lintGutter",
			text: strings["lint gutter"] || "Show lint gutter",
			checkbox: values.lintGutter ?? true,
			info: strings["settings-info-editor-lint-gutter"],
			category: categories.guidesIndicators,
		},
		{
			key: "showSpaces",
			text: strings["show spaces"],
			checkbox: values.showSpaces,
			info: strings["settings-info-editor-show-spaces"],
			category: categories.guidesIndicators,
		},
		{
			key: "indentGuides",
			text: strings["indent guides"] || "Indent guides",
			checkbox: values.indentGuides ?? true,
			info: strings["settings-info-editor-indent-guides"],
			category: categories.guidesIndicators,
		},
		{
			key: "rainbowBrackets",
			text: strings["rainbow brackets"] || "Rainbow brackets",
			checkbox: values.rainbowBrackets ?? true,
			info: strings["settings-info-editor-rainbow-brackets"],
			category: categories.guidesIndicators,
		},
		{
			key: "fadeFoldWidgets",
			text: strings["fade fold widgets"],
			checkbox: values.fadeFoldWidgets,
			info: strings["settings-info-editor-fade-fold-widgets"],
			category: categories.guidesIndicators,
		},
		{
			key: "shiftClickSelection",
			text: strings["shift click selection"],
			checkbox: values.shiftClickSelection,
			info: strings["settings-info-editor-shift-click-selection"],
			category: categories.cursorSelection,
		},
		{
			key: "rtlText",
			text: strings["line based rtl switching"],
			checkbox: values.rtlText,
			info: strings["settings-info-editor-rtl-text"],
			category: categories.cursorSelection,
		},
	];

	return settingsPage(title, items, callback, undefined, {
		preserveOrder: true,
		pageClassName: "detail-settings-page",
		listClassName: "detail-settings-list",
		infoAsDescription: true,
		valueInTail: true,
	});

	/**
	 * Callback for settings page when an item is clicked
	 * @param {string} key
	 * @param {string} value
	 */
	function callback(key, value) {
		switch (key) {
			case "scroll-settings":
				appSettings.uiSettings[key].show();
				return;

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

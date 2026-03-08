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
			key: "scroll-settings",
			text: strings["scroll settings"],
			info: "Scrollbar size, speed, and gesture behaviour",
			category: "Navigation",
			chevron: true,
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
			info: "Automatically save changes after a delay",
			category: "Editing",
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
			info: "Editor text size",
			category: "Editing",
		},
		{
			key: "softTab",
			text: strings["soft tab"],
			checkbox: values.softTab,
			info: "Use spaces instead of tabs",
			category: "Editing",
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
			info: "Number of spaces for each tab step",
			category: "Editing",
		},
		{
			key: "formatOnSave",
			text: strings["format on save"],
			checkbox: values.formatOnSave,
			info: "Run the formatter when saving files",
			category: "Editing",
		},
		{
			key: "editorFont",
			text: strings["editor font"],
			value: values.editorFont,
			get select() {
				return fonts.getNames();
			},
			info: "Typeface used in the editor",
			category: "Editing",
		},
		{
			key: "liveAutoCompletion",
			text: strings["live autocompletion"],
			checkbox: values.liveAutoCompletion,
			info: "Show suggestions while you type",
			category: "Editing",
		},
		{
			key: "textWrap",
			text: strings["text wrap"],
			checkbox: values.textWrap,
			info: "Wrap long lines inside the editor",
			category: "Display",
		},
		{
			key: "hardWrap",
			text: strings["hard wrap"],
			checkbox: values.hardWrap,
			info: "Insert line breaks instead of only wrapping visually",
			category: "Display",
		},
		{
			key: "linenumbers",
			text: strings["show line numbers"],
			checkbox: values.linenumbers,
			info: "Show the gutter with line numbers",
			category: "Display",
		},
		{
			key: "relativeLineNumbers",
			text: strings["relative line numbers"],
			checkbox: values.relativeLineNumbers,
			info: "Show distance from the current line",
			category: "Display",
		},
		{
			key: "lintGutter",
			text: strings["lint gutter"] || "Show lint gutter",
			checkbox: values.lintGutter ?? true,
			info: "Show diagnostics and lint markers in the gutter",
			category: "Display",
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
			info: "Vertical spacing between lines",
			category: "Display",
		},
		{
			key: "showSpaces",
			text: strings["show spaces"],
			checkbox: values.showSpaces,
			info: "Display visible whitespace markers",
			category: "Display",
		},
		{
			key: "colorPreview",
			text: strings["color preview"],
			checkbox: values.colorPreview,
			info: "Preview color values inline",
			category: "Display",
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
			info: "Cursor handle size for touch editing",
			category: "Cursor & Selection",
		},
		{
			key: "shiftClickSelection",
			text: strings["shift click selection"],
			checkbox: values.shiftClickSelection,
			info: "Extend selection with shift + tap or click",
			category: "Cursor & Selection",
		},
		{
			key: "rtlText",
			text: strings["line based rtl switching"],
			checkbox: values.rtlText,
			info: "Switch right-to-left behaviour per line",
			category: "Cursor & Selection",
		},
		{
			key: "fadeFoldWidgets",
			text: strings["fade fold widgets"],
			checkbox: values.fadeFoldWidgets,
			info: "Dim fold markers until they are needed",
			category: "Cursor & Selection",
		},
		{
			key: "rainbowBrackets",
			text: strings["rainbow brackets"] || "Rainbow brackets",
			checkbox: values.rainbowBrackets ?? true,
			info: "Color matching brackets by nesting level",
			category: "Cursor & Selection",
		},
		{
			key: "indentGuides",
			text: strings["indent guides"] || "Indent guides",
			checkbox: values.indentGuides ?? true,
			info: "Show indentation guide lines",
			category: "Cursor & Selection",
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

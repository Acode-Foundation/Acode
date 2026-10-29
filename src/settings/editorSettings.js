import settingsPage from "components/settingsPage";
import confirm from "dialogs/confirm";
import config from "lib/config";
import fonts from "lib/fonts";
import appSettings from "lib/settings";
import scrollSettings from "./scrollSettings";

/** Settings only canvas editors use; shown with the canvas renderer. */
const CANVAS_ONLY_SETTINGS = [
	"canvasBackend",
	"stickyScroll",
	"stickyScrollMaxLines",
	"canvasGutterMarkers",
	"cursorBlinkRate",
];

export default function editorSettings() {
	const title = strings["editor settings"];
	const values = appSettings.value;
	const rendererOptions = [
		["dom", strings["editor renderer dom"]],
		["canvas", strings["editor renderer canvas"]],
	];
	const canvasBackendOptions = [
		["auto", strings["canvas backend auto"]],
		["webgl2", "WebGL2"],
		["webgpu", "WebGPU"],
	];
	const gutterMarkerOptions = [
		["shared", strings["gutter markers shared"]],
		["columns", strings["gutter markers columns"]],
		["overlay", strings["gutter markers overlay"]],
	];
	const wrappingIndentOptions = [
		["none", strings.none],
		["same", strings["wrap-indent-same"]],
		["indent", strings["wrap-indent-indent"]],
		["deepIndent", strings["wrap-indent-deep"]],
	];
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
			key: "editorRenderer",
			text: strings["editor renderer"],
			value: values.editorRenderer ?? "dom",
			valueText: (value) =>
				rendererOptions.find(([key]) => key === value)?.[1] ??
				rendererOptions[0][1],
			select: rendererOptions,
			info: strings["settings-info-editor-renderer"],
			category: categories.textLayout,
		},
		{
			key: "canvasBackend",
			text: strings["canvas backend"],
			value: values.canvasBackend ?? "auto",
			valueText: (value) =>
				canvasBackendOptions.find(([key]) => key === value)?.[1] ??
				canvasBackendOptions[0][1],
			select: canvasBackendOptions,
			info: strings["settings-info-canvas-backend"],
			category: categories.textLayout,
		},
		{
			key: "stickyScroll",
			text: strings["sticky scroll"],
			checkbox: values.stickyScroll ?? false,
			info: strings["settings-info-sticky-scroll"],
			category: categories.textLayout,
		},
		{
			key: "stickyScrollMaxLines",
			text: strings["sticky scroll max lines"],
			value: values.stickyScrollMaxLines ?? 5,
			prompt: strings["sticky scroll max lines"],
			promptType: "number",
			promptOptions: {
				test(value) {
					value = Number.parseInt(value);
					return value >= 1 && value <= 10;
				},
			},
			info: strings["settings-info-sticky-scroll-max-lines"],
			category: categories.textLayout,
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
				match: config.FONT_SIZE,
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
			key: "wrappingIndent",
			text: strings["wrapped line indent"],
			value: values.wrappingIndent ?? "same",
			valueText: (value) =>
				wrappingIndentOptions.find(([key]) => key === value)?.[1] ??
				wrappingIndentOptions[1][1],
			select: wrappingIndentOptions,
			info: strings["settings-info-editor-wrapping-indent"],
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
			key: "localWordCompletion",
			text: strings["local word completion"],
			checkbox: values.localWordCompletion,
			info: strings["settings-info-editor-local-word-completion"],
			category: categories.assistance,
		},
		{
			key: "languageCompletion",
			text: strings["language package completion"],
			checkbox: values.languageCompletion ?? true,
			info: strings["settings-info-editor-language-completion"],
			category: categories.assistance,
		},
		{
			key: "recommendExtensions",
			text: strings["recommend extensions"],
			checkbox: values.recommendExtensions ?? true,
			info: strings["settings-info-editor-recommend-extensions"],
			category: categories.assistance,
		},
		{
			key: "useEmmet",
			text: strings["use emmet"],
			checkbox: values.useEmmet ?? true,
			category: categories.assistance,
		},
		{
			key: "autoCloseTags",
			text: strings["auto close tags"],
			checkbox: values.autoCloseTags,
			info: strings["settings-info-editor-auto-close-tags"],
			category: categories.assistance,
		},
		{
			key: "autoRenameTags",
			text: strings["auto rename tags"],
			checkbox: values.autoRenameTags ?? true,
			info: strings["settings-info-editor-auto-rename-tags"],
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
			key: "canvasGutterMarkers",
			text: strings["gutter markers"],
			value: values.canvasGutterMarkers ?? "shared",
			valueText: (value) =>
				gutterMarkerOptions.find(([key]) => key === value)?.[1] ??
				gutterMarkerOptions[0][1],
			select: gutterMarkerOptions,
			info: strings["settings-info-gutter-markers"],
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
			checkbox: values.indentGuides ?? false,
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
			key: "showShareButton",
			text: strings["show share button"],
			checkbox: values.showShareButton ?? true,
			info: strings["settings-info-editor-show-share-button"],
			category: categories.cursorSelection,
		},
		{
			key: "shiftClickSelection",
			text: strings["shift click selection"],
			checkbox: values.shiftClickSelection !== false,
			info: strings["settings-info-editor-shift-click-selection"],
			category: categories.cursorSelection,
		},
		{
			key: "cursorBlinkRate",
			text: strings["cursor blink rate"],
			value: values.cursorBlinkRate ?? 1200,
			prompt: strings["cursor blink rate"] + " (ms)",
			promptType: "number",
			promptOptions: {
				test(value) {
					value = Number.parseInt(value);
					return value >= 0 && value <= 10000;
				},
			},
			info: strings["settings-info-cursor-blink-rate"],
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

	for (const item of items) {
		if (CANVAS_ONLY_SETTINGS.includes(item.key)) {
			item.hidden = !isCanvasSettingVisible(item.key);
		}
	}

	const page = settingsPage(title, items, callback, undefined, {
		preserveOrder: true,
		pageClassName: "detail-settings-page",
		listClassName: "detail-settings-list",
		infoAsDescription: true,
		valueInTail: true,
	});

	// The page is created once and kept, so follow the renderer from here.
	appSettings.on("update:editorRenderer", updateCanvasSettings);
	appSettings.on("update:stickyScroll", updateCanvasSettings);

	return page;

	function isCanvasSettingVisible(key) {
		const { editorRenderer, stickyScroll } = appSettings.value;
		if (editorRenderer !== "canvas") return false;
		return key !== "stickyScrollMaxLines" || !!stickyScroll;
	}

	function updateCanvasSettings() {
		for (const key of CANVAS_ONLY_SETTINGS) {
			page.setItemVisibility(key, isCanvasSettingVisible(key));
		}
	}

	/**
	 * Callback for settings page when an item is clicked
	 * @param {string} key
	 * @param {string} value
	 */
	async function callback(key, value) {
		switch (key) {
			case "scroll-settings":
				appSettings.uiSettings[key].show();
				return;

			case "editorRenderer":
			case "canvasBackend":
				// Editors are created with their renderer and backend: reload
				// to switch (a backend change only matters to canvas editors).
				if (value === appSettings.value[key]) return;
				await appSettings.update({ [key]: value });
				if (
					(key === "editorRenderer" ||
						appSettings.value.editorRenderer === "canvas") &&
					(await confirm(strings.info, strings["reload to apply"]))
				) {
					await reloadApp();
				}
				return;

			case "stickyScrollMaxLines":
			case "cursorBlinkRate":
				appSettings.update({ [key]: Number.parseInt(value) });
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

	/** Reload once open files' edits are cached and the session is saved. */
	async function reloadApp() {
		await window.editorManager?.flushCacheWrites?.();
		window.acode?.exec("save-state");
		location.reload();
	}
}

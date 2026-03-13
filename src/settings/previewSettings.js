import settingsPage from "components/settingsPage";
import appSettings from "lib/settings";

export default function previewSettings() {
	const values = appSettings.value;
	const title = strings["preview settings"];
	const categories = {
		server: strings["settings-category-server"],
		preview: strings["settings-category-preview"],
	};
	const PORT_REGEX =
		/^([1-9][0-9]{0,3}|[1-5][0-9]{4}|6[0-4][0-9]{3}|65[0-4][0-9]{2}|655[0-2][0-9]|6553[0-5])$/;
	const items = [
		{
			key: "previewPort",
			text: strings["preview port"],
			value: values.previewPort,
			prompt: strings["preview port"],
			promptType: "number",
			promptOptions: {
				test(value) {
					return PORT_REGEX.test(value);
				},
			},
			info: strings["settings-info-preview-preview-port"],
			category: categories.server,
		},
		{
			key: "serverPort",
			text: strings["server port"],
			value: values.serverPort,
			prompt: strings["server port"],
			promptType: "number",
			promptOptions: {
				test(value) {
					return PORT_REGEX.test(value);
				},
			},
			info: strings["settings-info-preview-server-port"],
			category: categories.server,
		},
		{
			key: "previewMode",
			text: strings["preview mode"],
			value: values.previewMode,
			select: [
				[appSettings.PREVIEW_MODE_BROWSER, strings.browser],
				[appSettings.PREVIEW_MODE_INAPP, strings.inapp],
			],
			info: strings["settings-info-preview-mode"],
			category: categories.server,
		},
		{
			key: "host",
			text: strings.host,
			value: values.host,
			prompt: strings.host,
			promptType: "text",
			promptOptions: {
				test(value) {
					try {
						new URL(`http://${value}:${values.previewPort}`);
						return true;
					} catch (error) {
						return false;
					}
				},
			},
			info: strings["settings-info-preview-host"],
			category: categories.server,
		},
		{
			key: "disableCache",
			text: strings["disable in-app-browser caching"],
			checkbox: values.disableCache,
			info: strings["settings-info-preview-disable-cache"],
			category: categories.preview,
		},
		{
			key: "useCurrentFileForPreview",
			text: strings["should_use_current_file_for_preview"],
			checkbox: !!values.useCurrentFileForPreview,
			info: strings["settings-info-preview-use-current-file"],
			category: categories.preview,
		},
		{
			key: "showConsoleToggler",
			text: strings["show console toggler"],
			checkbox: values.showConsoleToggler,
			info: strings["settings-info-preview-show-console-toggler"],
			category: categories.preview,
		},
		{
			note: strings["preview settings note"],
		},
	];

	return settingsPage(title, items, callback, undefined, {
		preserveOrder: true,
		pageClassName: "detail-settings-page",
		listClassName: "detail-settings-list",
		infoAsDescription: true,
		valueInTail: true,
	});

	function callback(key, value) {
		appSettings.update({
			[key]: value,
		});
	}
}

import Checkbox from "components/checkbox";
import settingsPage from "components/settingsPage";
import appSettings from "lib/settings";

export default function previewSettings() {
	const values = appSettings.value;
	const title = strings["preview settings"];
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
		},
		{
			key: "previewMode",
			text: strings["preview mode"],
			value: values.previewMode,
			select: [
				[appSettings.PREVIEW_MODE_BROWSER, strings.browser],
				[appSettings.PREVIEW_MODE_INAPP, strings.inapp],
			],
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
		},
		{
			key: "disableCache",
			text: strings["disable in-app-browser caching"],
			checkbox: values.disableCache,
		},
		{
			key: "useCurrentFileForPreview",
			text: strings.should_use_current_file_for_preview,
			checkbox: !!values.useCurrentFileForPreview,
		},
		{
			key: "showConsoleToggler",
			text: strings["show console toggler"],
			checkbox: values.showConsoleToggler,
		},
		{
			note: strings["preview settings note"],
		},
	];

	return settingsPage(title, items, callback);

	function callback(key, value) {
		appSettings.update({
			[key]: value,
		});
	}
}

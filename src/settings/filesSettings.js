import settingsPage from "components/settingsPage";
import appSettings from "lib/settings";

export default function filesSettings() {
	const title = strings.settings;
	const values = appSettings.value.fileBrowser;

	const items = [
		{
			key: "sortByName",
			text: strings["sort by name"],
			checkbox: values.sortByName,
		},
		{
			key: "showHiddenFiles",
			text: strings["show hidden files"],
			checkbox: values.showHiddenFiles,
			info: strings["info-showHiddenFiles"],
		},
		{
			key: "listFiles",
			text: strings["title-listfiles"],
			checkbox: values.listFiles !== false,
			info:
				strings["info-listFiles"] ||
				"List all files in opened folders for quick search",
		},
	];

	return settingsPage(title, items, callback, undefined, {
		preserveOrder: true,
		pageClassName: "detail-settings-page",
		listClassName: "detail-settings-list",
		groupByDefault: true,
	});

	function callback(key, value) {
		appSettings.value.fileBrowser[key] = value;
		appSettings.update();
	}
}

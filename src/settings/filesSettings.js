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
	];

	return settingsPage(title, items, callback);

	function callback(key, value) {
		appSettings.value.fileBrowser[key] = value;
		appSettings.update();
	}
}

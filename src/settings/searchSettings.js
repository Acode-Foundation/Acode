import settingsPage from "../components/settingsPage";
import appSettings from "../lib/settings";

export default function searchSettings() {
	const title = strings.search;
	const values = appSettings.value.search;
	const items = [
		{
			key: "caseSensitive",
			text: strings["case sensitive"],
			checkbox: values.caseSensitive,
		},
		{
			key: "regExp",
			text: strings["regular expression"],
			checkbox: values.regExp,
		},
		{
			key: "wholeWord",
			text: strings["whole word"],
			checkbox: values.wholeWord,
		},
	];

	return settingsPage(title, items, callback, undefined, {
		preserveOrder: true,
		pageClassName: "detail-settings-page",
		listClassName: "detail-settings-list",
		groupByDefault: true,
	});

	function callback(key, value) {
		values[key] = value;
		appSettings.update();
	}
}

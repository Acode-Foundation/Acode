import settingsPage from "components/settingsPage";
import appSettings from "lib/settings";
import { getSort, getSortFieldLabel, SORT_FIELDS } from "lib/sortMenu";

/**
 * Shows the chosen option's label rather than its stored key ("size" would
 * otherwise appear as "size" instead of "Size").
 * @param {Array<[string, string]>} options
 */
function valueTextFor(options) {
	return (value) =>
		options.find(([key]) => key === value)?.[1] ?? String(value ?? "");
}

export default function filesSettings() {
	const title = strings.settings;
	const values = appSettings.value.fileBrowser;
	const sort = getSort();
	const fieldOptions = SORT_FIELDS.map((field) => [
		field,
		getSortFieldLabel(field),
	]);
	const orderOptions = [
		["asc", strings.ascending || "Ascending"],
		["desc", strings.descending || "Descending"],
	];

	const items = [
		{
			key: "sortByName",
			text: strings["sort by name"],
			checkbox: values.sortByName,
			info:
				strings["info-sortBy"] || "Group folders first and sort each group.",
		},
		{
			key: "sortBy",
			text: strings["sort by"] || "Sort by",
			select: fieldOptions,
			value: sort.sortBy === "none" ? "name" : sort.sortBy,
			valueText: valueTextFor(fieldOptions),
		},
		{
			key: "sortOrder",
			text: strings["sort order"] || "Sort order",
			select: orderOptions,
			value: sort.sortOrder,
			valueText: valueTextFor(orderOptions),
		},
		{
			key: "foldersFirst",
			text: strings["folders first"] || "Folders first",
			checkbox: values.foldersFirst !== false,
			info:
				strings["info-foldersFirst"] ||
				"Group folders above files. Turn off to mix both in one order.",
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
		if (key === "sortBy" && value !== "none") {
			appSettings.value.fileBrowser.sortByName = true;
		}
		appSettings.update();
	}
}

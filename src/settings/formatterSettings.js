import { getModes } from "cm/modelist";
import settingsPage from "components/settingsPage";
import appSettings from "lib/settings";

export default function formatterSettings(languageName) {
	const title = strings.formatter;
	const values = appSettings.value;
	const { formatters } = acode;

	// Build items from CodeMirror modelist
	const items = getModes().map((mode) => {
		const { name, caption, extensions } = mode;
		const formatterID = values.formatter[name] || null;
		// Only pass real extensions (skip anchored filename patterns like ^Dockerfile)
		const extList = String(extensions)
			.split("|")
			.filter((e) => e && !e.startsWith("^"));
		const options = acode.getFormatterFor(extList);

		return {
			key: name,
			text: caption,
			icon: `file file_type_default file_type_${name}`,
			value: formatterID,
			valueText: (value) => {
				const formatter = formatters.find(({ id }) => id === value);
				if (formatter) {
					return formatter.name;
				}
				return strings.none;
			},
			select: options,
		};
	});

	const page = settingsPage(title, items, callback, "separate");
	page.show(languageName);

	function callback(key, value) {
		if (value === null) {
			// Delete the key when "none" is selected
			delete values.formatter[key];
		} else {
			values.formatter[key] = value;
		}
		appSettings.update();
	}
}

import settingsPage from "components/settingsPage";
import appSettings from "lib/settings";

export default function formatterSettings(languageName) {
	const title = strings.formatter;
	const values = appSettings.value;
	const { formatters } = acode;
	const { modes } = ace.require("ace/ext/modelist");

	const items = modes.map((mode) => {
		const { name, caption } = mode;
		const formatterID = values.formatter[name] || null;
		const extensions = mode.extensions.split("|");
		const options = acode.getFormatterFor(extensions);

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

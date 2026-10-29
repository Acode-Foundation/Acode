import { getFormatAsMode, getMode, getModes } from "cm/modelist";
import settingsPage from "components/settingsPage";
import appSettings from "lib/settings";

export default function formatterSettings(languageName) {
	const title = strings.formatter;
	const values = appSettings.value;
	const { formatters } = acode;
	const languagesLabel = strings.languages || "Languages";

	// Build items from CodeMirror modelist
	const items = getModes()
		.slice()
		.sort((a, b) =>
			String(a.caption || a.name).localeCompare(String(b.caption || b.name)),
		)
		.map((mode) => {
			const { name, caption, extensions } = mode;
			const formatterID = values.formatter[name] || null;
			// Only pass real extensions (skip anchored filename patterns like ^Dockerfile)
			const extList = String(extensions)
				.split("|")
				.filter((e) => e && !e.startsWith("^"));
			// Also offer formatters of the mode this one formats as
			const baseMode = getMode(getFormatAsMode(name) || "");
			const baseExts = String(baseMode?.extensions || "")
				.split("|")
				.filter((e) => e && !e.startsWith("^"));
			const options = acode.getFormatterFor([...extList, ...baseExts]);
			const sampleExt = extList[0] || name;
			// Unset falls back to the base mode's formatter, so say which one
			const inheritedText = () => {
				const inherited = formatters.find(
					({ id }) => id === values.formatter[baseMode.name],
				);
				return inherited ? `${inherited.name} (${baseMode.caption})` : null;
			};

			return {
				key: name,
				text: caption,
				fileIcon: { name: `sample.${sampleExt}` },
				value: formatterID,
				valueText: (value) => {
					const formatter = formatters.find(({ id }) => id === value);
					if (formatter) {
						return formatter.name;
					}
					return (baseMode && inheritedText()) || strings.none;
				},
				// Read when the picker opens, so the inherited label stays current
				get select() {
					if (baseMode) options[0] = [null, inheritedText() || strings.none];
					return options;
				},
				chevron: true,
				category: languagesLabel,
			};
		});

	items.unshift({
		note: strings["settings-note-formatter-settings"],
	});

	const page = settingsPage(title, items, callback, "separate", {
		preserveOrder: true,
		pageClassName: "detail-settings-page formatter-settings-page",
		listClassName: "detail-settings-list formatter-settings-list",
		notePosition: "top",
	});
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

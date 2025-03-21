import "./style.scss";
import palette from "components/palette";
import appSettings from "lib/settings";
import themes from "theme/list";

export default function changeTheme(type = "editor") {
	palette(
		() => generateHints(type),
		(value) => onselect(value),
		strings[type === "editor" ? "editor theme" : "app theme"],
	);
}

function generateHints(type) {
	if (type === "editor") {
		const themeList = ace.require("ace/ext/themelist");
		const currentTheme = appSettings.value.editorTheme;
		const themePrefix = "ace/theme/";

		return themeList.themes.map((theme) => {
			const isCurrent =
				theme.theme ===
				(currentTheme.startsWith(themePrefix)
					? currentTheme
					: themePrefix + currentTheme);

			return {
				value: JSON.stringify({ type: "editor", theme: theme.theme }),
				text: `<div class="theme-item">
										<span>${theme.caption}</span>
										${isCurrent ? '<span class="current">current</span>' : ""}
								</div>`,
			};
		});
	}

	// App themes
	const currentTheme = appSettings.value.appTheme;
	const availableThemes = themes
		.list()
		.filter((theme) => !(theme.version === "paid" && IS_FREE_VERSION));

	return availableThemes.map((theme) => {
		const isCurrent = theme.id === currentTheme;

		return {
			value: JSON.stringify({
				type: "app",
				theme: theme.id,
			}),
			text: `<div class="theme-item">
								<span>${theme.name}</span>
								${isCurrent ? '<span class="current">current</span>' : ""}
						</div>`,
		};
	});
}

function onselect(value) {
	if (!value) return;

	const selection = JSON.parse(value);

	if (selection.type === "editor") {
		editorManager.editor.setTheme(selection.theme);
		appSettings.update(
			{
				editorTheme: selection.theme,
			},
			false,
		);
	} else {
		if (selection.theme === "custom") {
			CustomTheme();
			return;
		}
		themes.apply(selection.theme, true);
	}
}

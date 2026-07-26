import "./style.scss";
import palette from "components/palette";
import config from "lib/config";
import appSettings from "lib/settings";
import themes, { updateSystemThemeWatcher } from "theme/list";
import changeEditorTheme from "../changeEditorTheme";

export default function changeTheme(type = "editor") {
	if (type === "editor") return changeEditorTheme();
	palette(
		() => generateHints(type),
		(value) => onselect(value),
		strings["app theme"],
	);
}

function generateHints(type) {
	// Editor handled by changeEditorTheme

	// App themes
	const currentTheme = appSettings.value.appTheme;
	const availableThemes = themes
		.list()
		.filter((theme) => !(theme.version === "paid" && !config.HAS_PRO));

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

	updateSystemThemeWatcher(selection.theme);

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

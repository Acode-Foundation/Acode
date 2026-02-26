import { getThemes } from "cm/themes";
import palette from "components/palette";
import appSettings from "lib/settings";

export default function changeEditorTheme() {
	palette(generateHints, onselect, strings["editor theme"]);
}

function generateHints() {
	const themes = getThemes();
	const current = String(
		appSettings.value.editorTheme || "one_dark",
	).toLowerCase();
	return themes.map((t) => {
		const isCurrent = current === t.id;
		return {
			value: t.id,
			text: `<div class="theme-item"><span>${t.caption}</span>${isCurrent ? '<span class="current">current</span>' : ""}</div>`,
		};
	});
}

function onselect(themeId) {
	if (!themeId) return;
	const ok = editorManager.editor.setTheme(themeId);
	if (!ok) return;
	appSettings.update({ editorTheme: themeId }, false);
}

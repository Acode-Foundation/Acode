import { getModes } from "cm/modelist";
import palette from "components/palette";
import helpers from "utils/helpers";
import Path from "utils/Path";

export default function changeMode() {
	palette(generateHints, onselect, strings["syntax highlighting"]);
}

function generateHints() {
	const modes = [...getModes()].sort((a, b) =>
		a.caption.localeCompare(b.caption),
	);
	const activeMode = editorManager.activeFile?.currentMode || "";
	const activeIndex = modes.findIndex(({ mode }) => mode === activeMode);

	if (activeIndex > 0) {
		const [activeEntry] = modes.splice(activeIndex, 1);
		modes.unshift(activeEntry);
	}

	return modes.map(({ aliases = [], caption, extensions, mode }) => {
		const searchTerms = [caption, mode, extensions, ...aliases]
			.filter(Boolean)
			.join(" ");
		const title =
			caption.toLowerCase() === mode ? caption : `${caption} (${mode})`;

		return {
			active: mode === activeMode,
			value: mode,
			text: `<div style="display: flex; flex-direction: column;">
      <strong style="font-size: 1rem;">${title}</strong>
      <span hidden>${searchTerms}</span>
    </div>`,
		};
	});
}

function onselect(mode) {
	const activeFile = editorManager.activeFile;

	let modeAssociated;
	try {
		modeAssociated = helpers.parseJSON(localStorage.modeassoc) || {};
	} catch (error) {
		modeAssociated = {};
	}

	modeAssociated[Path.extname(activeFile.filename)] = mode;
	localStorage.modeassoc = JSON.stringify(modeAssociated);

	activeFile.setMode(mode);
}

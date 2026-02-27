import { getModes } from "cm/modelist";
import palette from "components/palette";
import helpers from "utils/helpers";
import Path from "utils/Path";

export default function changeMode() {
	palette(generateHints, onselect, strings["syntax highlighting"]);
}

function generateHints() {
	const modes = getModes();

	return modes.map(({ caption, mode, extensions }) => {
		return {
			value: mode,
			text: `<div style="display: flex; flex-direction: column;">
      <strong style="font-size: 1rem;">${caption}</strong>
      <span style="font-size: 0.8rem; opacity: 0.8;">${mode}</span>
    <div><span hidden>${extensions}</span>`,
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

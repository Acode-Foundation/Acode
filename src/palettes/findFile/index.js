import palette from "components/palette";
import files from "lib/fileList";
import openFile from "lib/openFile";
import recents from "lib/recents";
import helpers from "utils/helpers";

/**
 * @typedef {import('components/inputhints').HintModification} HintModification
 */

/**@type {HintModification} */
let hintsModification;

export default async function findFile() {
	palette(generateHints, onselect, strings["type filename"], () => {
		files.off("add-file", onAddFile);
		files.off("remove-file", onRemoveFile);
	});

	files.on("add-file", onAddFile);
	files.on("remove-file", onRemoveFile);

	/**
	 * Generates hint for inputhints
	 * @param {HintModification} hints Hint modification object
	 */
	async function generateHints(hints) {
		hintsModification = hints;
		const list = [];

		for (const file of editorManager.files) {
			const { uri, name } = file;
			let { location = "" } = file;

			if (location) {
				location = helpers.getVirtualPath(location);
			}

			list.push(hintItem(name, location, uri));
		}

		list.push(...files(hintItem));
		return list;
	}

	function onselect(value) {
		if (!value) return;
		openFile(value);
	}
}

/**
 * Generates hint item for inputhints
 * @param {string|{name: string, path: string, url: string}} name Hint text
 * @param {string} path Hint subtext
 * @param {string} url Hint value
 * @returns {{text: string, value: string}}
 */
function hintItem(name, path, url) {
	if (typeof name === "object") {
		({ name, path, url } = name);
	}
	const recent = recents.files.find((file) => file === url);
	let subText = (path || url) ?? strings["new file"];
	if (subText.length > 50) {
		subText = `...${subText.slice(-50)}`;
	}
	return {
		text: `<div style="display: flex; flex-direction: column;">
        <strong ${recent ? `data-str='${strings["recently used"]}'` : ""} style="font-size: 1rem;">${name}</strong>
        <span style="font-size: 0.8rem; opacity: 0.8;">${subText}</span>
      <div>`,
		value: url,
	};
}

function onAddFile({ name, url, path: visiblePath }) {
	hintsModification?.add(hintItem(name, visiblePath, url));
}

function onRemoveFile({ name, url, path: visiblePath }) {
	hintsModification?.remove(hintItem(name, visiblePath, url));
}

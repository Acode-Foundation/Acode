import palette from "components/palette";
import fileIndex from "lib/fileIndex";
import files from "lib/fileList";
import openFile from "lib/openFile";
import { addedFolder } from "lib/openFolder";
import recents from "lib/recents";
import helpers from "utils/helpers";

/**
 * @typedef {import('components/inputhints').HintModification} HintModification
 */

/**@type {HintModification} */
let hintsModification;

export default async function findFile() {
	palette(
		generateHints,
		onselect,
		strings["type filename"],
		() => {
			files.off("add-file", onAddFile);
			files.off("remove-file", onRemoveFile);
		},
		{ dynamic: true },
	);

	files.on("add-file", onAddFile);
	files.on("remove-file", onRemoveFile);

	/**
	 * Generates hint for inputhints
	 * @param {HintModification} hints Hint modification object
	 */
	async function generateHints(hints, query = "") {
		hintsModification = hints;
		const list = [];
		const seen = new Set();

		editorManager.files.forEach((file) => {
			const { uri, name } = file;
			if (!matchesQuery(query, name, uri)) return;
			let { location = "" } = file;

			if (location) {
				location = helpers.getVirtualPath(location);
			}

			if (uri) seen.add(uri);
			list.push(hintItem(name, location, uri));
		});

		files().forEach((file) => {
			if (seen.has(file.url)) return;
			if (!matchesQuery(query, file.name, file.path)) return;
			seen.add(file.url);
			list.push(hintItem(file));
		});

		const nativeRoots = addedFolder
			.filter(({ listFiles }) => listFiles)
			.map(({ url }) => url)
			.filter((url) => fileIndex.supports(url));
		if (nativeRoots.length) {
			try {
				const { entries = [] } = await fileIndex.query({
					roots: nativeRoots,
					text: query,
					limit: 300,
				});
				entries.forEach((file) => {
					if (seen.has(file.url)) return;
					seen.add(file.url);
					list.push(hintItem(file));
				});
			} catch (error) {
				console.warn("Unable to query native file index:", error);
			}
		}
		return list;
	}

	function onselect(value) {
		if (!value) return;
		openFile(value);
	}
}

function matchesQuery(query, ...values) {
	if (!query) return true;
	const normalized = query.toLowerCase();
	return values.some((value) =>
		String(value || "")
			.toLowerCase()
			.includes(normalized),
	);
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

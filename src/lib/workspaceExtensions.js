/** File inside `.acode` that holds the recommendations. */
export const EXTENSIONS_FILE = "extensions.json";

/** Larger files are not read: this file is tiny, and some file systems are remote. */
export const MAX_EXTENSIONS_FILE_SIZE = 64 * 1024;

/** A project suggesting more than this is more likely spam than advice. */
export const MAX_RECOMMENDATIONS = 10;

/** What a plugin id looks like. Must never match anything path- or URL-like. */
const PLUGIN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/**
 * @typedef {object} ExtensionRecommendations
 * @property {readonly string[]} recommendations Valid plugin ids, without duplicates.
 * @property {readonly string[]} problems Why part or all of the file was not used. Empty when it is fine.
 */

/** No recommendations. Shared, so it must stay frozen. @type {Readonly<ExtensionRecommendations>} */
export const NO_RECOMMENDATIONS = Object.freeze({
	recommendations: Object.freeze([]),
	problems: Object.freeze([]),
});

/**
 * Tell whether a value is an acceptable plugin id.
 * @param {unknown} id
 * @returns {boolean}
 */
export function isPluginId(id) {
	return typeof id === "string" && PLUGIN_ID.test(id);
}

/**
 * Read the text of an `.acode/extensions.json`.
 * Never throws. A bad file yields no recommendations plus a description of what
 * is wrong, and a bad entry costs only that entry, not the rest of the list.
 * @param {string} text
 * @returns {ExtensionRecommendations}
 */
export function parseExtensionRecommendations(text) {
	if (typeof text !== "string" || !text.trim()) return NO_RECOMMENDATIONS;

	let data;
	try {
		data = JSON.parse(text);
	} catch (error) {
		return freeze([], [`Not valid JSON (${error.message})`]);
	}

	if (data === null || typeof data !== "object" || Array.isArray(data)) {
		return freeze([], ["Expected a JSON object"]);
	}

	// Unknown keys are ignored: they may belong to a newer Acode.
	if (!Object.prototype.hasOwnProperty.call(data, "recommendations")) {
		return NO_RECOMMENDATIONS;
	}

	const list = data.recommendations;
	if (!Array.isArray(list)) {
		return freeze([], ['"recommendations" must be a list of plugin ids']);
	}

	const recommendations = [];
	const problems = [];

	for (const entry of list) {
		if (!isPluginId(entry)) {
			problems.push(`${describe(entry)} is not a valid plugin id`);
			continue;
		}
		if (recommendations.includes(entry)) continue;
		if (recommendations.length >= MAX_RECOMMENDATIONS) {
			problems.push(`Only the first ${MAX_RECOMMENDATIONS} plugins are used`);
			break;
		}
		recommendations.push(entry);
	}

	return freeze(recommendations, problems);
}

/**
 * A result for a file that could not be used at all, e.g. because it is too big.
 * @param {string} problem
 * @returns {ExtensionRecommendations}
 */
export function unusableRecommendations(problem) {
	return freeze([], [problem]);
}

/**
 * Tell whether two parse results say the same thing.
 * @param {ExtensionRecommendations} a
 * @param {ExtensionRecommendations} b
 * @returns {boolean}
 */
export function sameRecommendations(a, b) {
	return (
		JSON.stringify([a.recommendations, a.problems]) ===
		JSON.stringify([b.recommendations, b.problems])
	);
}

/**
 * Show an offending entry in a message without trusting its size or content.
 * @param {unknown} entry
 * @returns {string}
 */
function describe(entry) {
	if (typeof entry !== "string")
		return `A ${entry === null ? "null" : typeof entry} entry`;
	const shown = entry.length > 40 ? `${entry.slice(0, 40)}…` : entry;
	return `"${shown}"`;
}

function freeze(recommendations, problems) {
	return Object.freeze({
		recommendations: Object.freeze(recommendations),
		problems: Object.freeze(problems),
	});
}

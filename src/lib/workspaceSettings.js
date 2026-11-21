/** File inside `.acode` that holds the project settings. */
export const SETTINGS_FILE = "settings.json";

/** Larger files are not read: settings are tiny, and some file systems are remote. */
export const MAX_SETTINGS_SIZE = 64 * 1024;

const hasOwn = (object, key) =>
	Object.prototype.hasOwnProperty.call(object, key);

/**
 * Settings a project may override, with a check for each value.
 * The ranges match what Acode's own settings screen accepts.
 * @type {Record<string, {check: (value: unknown) => boolean, expected: string}>}
 */
const schema = {
	tabSize: {
		check: (value) => Number.isInteger(value) && value >= 1 && value <= 8,
		expected: "a whole number from 1 to 8",
	},
	softTab: {
		check: (value) => typeof value === "boolean",
		expected: "true or false",
	},
	formatOnSave: {
		check: (value) => typeof value === "boolean",
		expected: "true or false",
	},
};

/** Names of the settings a project may override. */
export const PROJECT_SETTING_KEYS = Object.freeze(Object.keys(schema));

/**
 * @typedef {object} ProjectSettings
 * @property {Readonly<Record<string, any>>} values Valid overrides.
 * @property {string[]} problems Why part or all of the file was not used. Empty when it is fine.
 * @property {string[]} ignored Names of settings that are not recognised.
 */

/** No overrides. Shared, so it must stay frozen. @type {Readonly<ProjectSettings>} */
export const NO_PROJECT_SETTINGS = Object.freeze({
	values: Object.freeze({}),
	problems: Object.freeze([]),
	ignored: Object.freeze([]),
});

/**
 * Read the text of a `.acode/settings.json`.
 * Never throws. A bad file yields no overrides plus a description of what is
 * wrong, and a bad value costs only that value, not the rest of the file.
 * @param {string} text
 * @returns {ProjectSettings}
 */
export function parseProjectSettings(text) {
	if (typeof text !== "string" || !text.trim()) return NO_PROJECT_SETTINGS;

	let data;
	try {
		data = JSON.parse(text);
	} catch (error) {
		return freeze({}, [`Not valid JSON (${error.message})`], []);
	}

	if (data === null || typeof data !== "object" || Array.isArray(data)) {
		return freeze({}, ["Expected a JSON object"], []);
	}

	const values = {};
	const problems = [];
	const ignored = [];

	// Own properties only, so keys like "__proto__" or "toString" mean nothing.
	for (const key of Object.keys(data)) {
		if (!hasOwn(schema, key)) {
			ignored.push(key);
			continue;
		}
		if (schema[key].check(data[key])) {
			values[key] = data[key];
		} else {
			problems.push(`"${key}" must be ${schema[key].expected}`);
		}
	}

	return freeze(values, problems, ignored);
}

/**
 * A result for a file that could not be used at all, e.g. because it is too big.
 * @param {string} problem
 * @returns {ProjectSettings}
 */
export function unusableProjectSettings(problem) {
	return freeze({}, [problem], []);
}

/**
 * Tell whether two parse results say the same thing.
 * @param {ProjectSettings} a
 * @param {ProjectSettings} b
 * @returns {boolean}
 */
export function sameProjectSettings(a, b) {
	return (
		JSON.stringify([a.values, a.problems]) ===
		JSON.stringify([b.values, b.problems])
	);
}

function freeze(values, problems, ignored) {
	return Object.freeze({
		values: Object.freeze(values),
		problems: Object.freeze(problems),
		ignored: Object.freeze(ignored),
	});
}

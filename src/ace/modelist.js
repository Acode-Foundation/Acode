const modesByName = {};
const modes = [];

export function initModes() {
	ace.define(
		"ace/ext/modelist",
		["require", "exports", "module"],
		function (require, exports, module) {
			/**
			 * Calculates a specificity score for a mode.
			 * Higher score means more specific.
			 * - Anchored patterns (e.g., "^Dockerfile") get a base score of 1000.
			 * - Non-anchored patterns (extensions) are scored by length.
			 */
			function getModeSpecificityScore(modeInstance) {
				const extensionsStr = modeInstance.extensions;
				if (!extensionsStr) return 0;

				const patterns = extensionsStr.split("|");
				let maxScore = 0;

				for (const pattern of patterns) {
					let currentScore = 0;
					if (pattern.startsWith("^")) {
						// Exact filename match or anchored pattern
						currentScore = 1000 + (pattern.length - 1); // Subtract 1 for '^'
					} else {
						// Extension match
						currentScore = pattern.length;
					}
					if (currentScore > maxScore) {
						maxScore = currentScore;
					}
				}
				return maxScore;
			}
			module.exports = {
				getModeForPath(path) {
					let mode = modesByName.text;
					let fileName = path.split(/[\/\\]/).pop();
					// Sort modes by specificity (descending) to check most specific first
					const sortedModes = [...modes].sort((a, b) => {
						return getModeSpecificityScore(b) - getModeSpecificityScore(a);
					});

					for (const iMode of sortedModes) {
						if (iMode.supportsFile?.(fileName)) {
							mode = iMode;
							break;
						}
					}
					return mode;
				},
				get modesByName() {
					return modesByName;
				},
				get modes() {
					return modes;
				},
			};
		},
	);
}

/**
 * Add language mode to ace editor
 * @param {string} name name of the mode
 * @param {string|Array<string>} extensions extensions of the mode
 * @param {string} [caption] display name of the mode
 */
export function addMode(name, extensions, caption) {
	const filename = name.toLowerCase();
	const mode = new Mode(filename, caption, extensions);
	modesByName[filename] = mode;
	modes.push(mode);
}

/**
 * Remove language mode from ace editor
 * @param {string} name
 */
export function removeMode(name) {
	const filename = name.toLowerCase();
	delete modesByName[filename];
	const modeIndex = modes.findIndex((mode) => mode.name === filename);
	if (modeIndex >= 0) {
		modes.splice(modeIndex, 1);
	}
}

class Mode {
	extensions;
	displayName;
	name;
	mode;
	extRe;

	/**
	 * Create a new mode
	 * @param {string} name
	 * @param {string} caption
	 * @param {string|Array<string>} extensions
	 */
	constructor(name, caption, extensions) {
		if (Array.isArray(extensions)) {
			extensions = extensions.join("|");
		}

		this.name = name;
		this.mode = "ace/mode/" + name;
		this.extensions = extensions;
		this.caption = caption || this.name.replace(/_/g, " ");
		let re;

		if (/\^/.test(extensions)) {
			re =
				extensions.replace(/\|(\^)?/g, function (a, b) {
					return "$|" + (b ? "^" : "^.*\\.");
				}) + "$";
		} else {
			re = "^.*\\.(" + extensions + ")$";
		}

		this.extRe = new RegExp(re, "i");
	}

	supportsFile(filename) {
		return this.extRe.test(filename);
	}
}

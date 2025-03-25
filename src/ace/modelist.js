const modesByName = {};
const modes = [];

export function initModes() {
	ace.define(
		"ace/ext/modelist",
		["require", "exports", "module"],
		(require, exports, module) => {
			module.exports = {
				getModeForPath(path) {
					let mode = modesByName.text;
					const fileName = path.split(/[\/\\]/).pop();
					for (const iMode of modes) {
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
				extensions.replace(/\|(\^)?/g, (a, b) => "$|" + (b ? "^" : "^.*\\.")) +
				"$";
		} else {
			re = "^.*\\.(" + extensions + ")$";
		}

		this.extRe = new RegExp(re, "i");
	}

	supportsFile(filename) {
		return this.extRe.test(filename);
	}
}

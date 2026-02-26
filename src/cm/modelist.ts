import type { Extension } from "@codemirror/state";

export type LanguageExtensionProvider = () => Extension | Promise<Extension>;

export interface ModesByName {
	[name: string]: Mode;
}

const modesByName: ModesByName = {};
const modes: Mode[] = [];

/**
 * Initialize CodeMirror mode list functionality
 */
export function initModes(): void {
	// CodeMirror modes don't need the same ace.define wrapper
	// but we maintain the same API structure for compatibility
}

/**
 * Add language mode to CodeMirror editor
 */
export function addMode(
	name: string,
	extensions: string | string[],
	caption?: string,
	languageExtension: LanguageExtensionProvider | null = null,
): void {
	const filename = name.toLowerCase();
	const mode = new Mode(filename, caption, extensions, languageExtension);
	modesByName[filename] = mode;
	modes.push(mode);
}

/**
 * Remove language mode from CodeMirror editor
 */
export function removeMode(name: string): void {
	const filename = name.toLowerCase();
	delete modesByName[filename];
	const modeIndex = modes.findIndex((mode) => mode.name === filename);
	if (modeIndex >= 0) {
		modes.splice(modeIndex, 1);
	}
}

/**
 * Get mode for file path
 */
export function getModeForPath(path: string): Mode {
	let mode = modesByName.text;
	const fileName = path.split(/[/\\]/).pop() || "";

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
}

/**
 * Calculates a specificity score for a mode.
 * Higher score means more specific.
 * - Anchored patterns (e.g., "^Dockerfile") get a base score of 1000.
 * - Non-anchored patterns (extensions) are scored by length.
 */
function getModeSpecificityScore(modeInstance: Mode): number {
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

/**
 * Get all modes by name
 */
export function getModesByName(): ModesByName {
	return modesByName;
}

/**
 * Get all modes array
 */
export function getModes(): Mode[] {
	return modes;
}

export class Mode {
	extensions: string;
	caption: string;
	name: string;
	mode: string;
	extRe: RegExp;
	languageExtension: LanguageExtensionProvider | null;

	constructor(
		name: string,
		caption: string | undefined,
		extensions: string | string[],
		languageExtension: LanguageExtensionProvider | null = null,
	) {
		if (Array.isArray(extensions)) {
			extensions = extensions.join("|");
		}

		this.name = name;
		this.mode = name; // CodeMirror uses different mode naming
		this.extensions = extensions;
		this.caption = caption || this.name.replace(/_/g, " ");
		this.languageExtension = languageExtension;
		let re: string;

		if (/\^/.test(extensions)) {
			re =
				extensions.replace(/\|(\^)?/g, function (_a: string, b: string) {
					return "$|" + (b ? "^" : "^.*\\.");
				}) + "$";
		} else {
			re = "^.*\\.(" + extensions + ")$";
		}

		this.extRe = new RegExp(re, "i");
	}

	supportsFile(filename: string): boolean {
		return this.extRe.test(filename);
	}

	/**
	 * Get the CodeMirror language extension
	 */
	getExtension(): LanguageExtensionProvider | null {
		return this.languageExtension;
	}

	/**
	 * Check if the language extension is available (loaded)
	 */
	isAvailable(): boolean {
		return this.languageExtension !== null;
	}
}

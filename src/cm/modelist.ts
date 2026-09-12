import type { Extension } from "@codemirror/state";

export type LanguageExtensionProvider = () => Extension | Promise<Extension>;

export interface AddModeOptions {
	aliases?: string[];
	filenameMatchers?: RegExp[];
}

export interface ModesByName {
	[name: string]: Mode;
}

const modesByName: ModesByName = {};
const modes: Mode[] = [];

const FILE_NAME_CACHE_LIMIT = 2000;

interface NamedCheck {
	mode: Mode;
	exactName?: string;
	matcher?: RegExp;
}

interface ModeIndex {
	sorted: Mode[];
	namedChecks: NamedCheck[];
	extensions: Map<string, Mode>;
	rankByMode: Map<Mode, number>;
}

let modeIndex: ModeIndex | null = null;
const resolvedByFileName = new Map<string, Mode>();

function normalizeModeKey(value: string): string {
	return String(value ?? "")
		.trim()
		.toLowerCase();
}

function normalizeAliases(aliases: string[] = [], name: string): string[] {
	const normalized = new Set<string>();
	for (const alias of aliases) {
		const key = normalizeModeKey(alias);
		if (!key || key === name) continue;
		normalized.add(key);
	}
	return [...normalized];
}

function escapeRegExp(value: string): string {
	return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function fileNameFromPath(path: string): string {
	const value = String(path ?? "");
	const slash = value.lastIndexOf("/");
	const backslash = value.lastIndexOf("\\");
	const sep = slash > backslash ? slash : backslash;
	return sep === -1 ? value : value.slice(sep + 1);
}

function invalidateModeIndex(): void {
	modeIndex = null;
	resolvedByFileName.clear();
}

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
	options: AddModeOptions = {},
): void {
	const filename = normalizeModeKey(name);
	const mode = new Mode(
		filename,
		caption,
		extensions,
		languageExtension,
		options,
	);
	modesByName[filename] = mode;
	mode.aliases.forEach((alias) => {
		if (!modesByName[alias]) {
			modesByName[alias] = mode;
		}
	});
	modes.push(mode);
	invalidateModeIndex();
}

/**
 * Remove language mode from CodeMirror editor
 */
export function removeMode(name: string): void {
	const filename = normalizeModeKey(name);
	const mode = modesByName[filename];
	if (!mode) return;

	delete modesByName[mode.name];
	mode.aliases.forEach((alias) => {
		if (modesByName[alias] === mode) {
			delete modesByName[alias];
		}
	});

	const modeIndexInList = modes.findIndex(
		(registeredMode) => registeredMode === mode,
	);
	if (modeIndexInList >= 0) {
		modes.splice(modeIndexInList, 1);
	}
	invalidateModeIndex();
}

/**
 * Calculates a specificity score for a mode.
 * Higher score means more specific.
 * - Anchored patterns (e.g., "^Dockerfile") get a base score of 1000.
 * - Non-anchored patterns (extensions) are scored by length.
 */
function getModeSpecificityScore(modeInstance: Mode): number {
	if (modeInstance.name.toLowerCase() === "text") {
		return 0;
	}

	const extensionsStr = modeInstance.extensions;
	let maxScore = 0;

	if (extensionsStr) {
		const patterns = extensionsStr.split("|");
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
	}

	for (const matcher of modeInstance.filenameMatchers) {
		const score = 1000 + matcher.source.length;
		if (score > maxScore) {
			maxScore = score;
		}
	}

	return maxScore;
}

function exactNameFromRegex(matcher: RegExp): string | null {
	const otherFlags = matcher.flags.replaceAll("i", "");
	if (otherFlags) return null;

	const source = matcher.source;
	if (
		source.length < 2 ||
		source[0] !== "^" ||
		source[source.length - 1] !== "$"
	) {
		return null;
	}

	const inner = source.slice(1, -1);
	let name = "";
	for (let i = 0; i < inner.length; i++) {
		const ch = inner[i];
		if (ch === "\\") {
			const next = inner[i + 1];
			if (!next) return null;
			name += next;
			i++;
			continue;
		}
		if ("^$|.*+?()[]{}".includes(ch)) return null;
		name += ch;
	}

	return name ? name.toLowerCase() : null;
}

function rememberFirst(map: Map<string, Mode>, key: string, mode: Mode): void {
	if (key && !map.has(key)) {
		map.set(key, mode);
	}
}

function getModeIndex(): ModeIndex {
	if (modeIndex) return modeIndex;

	const ranked = modes.map((mode, index) => ({
		mode,
		score: getModeSpecificityScore(mode),
		index,
	}));
	ranked.sort((a, b) => {
		const scoreDiff = b.score - a.score;
		return scoreDiff !== 0 ? scoreDiff : b.index - a.index;
	});

	const sorted = ranked.map((entry) => entry.mode);
	const rankByMode = new Map<Mode, number>();
	const namedChecks: NamedCheck[] = [];
	const extensions = new Map<string, Mode>();

	for (let rank = 0; rank < sorted.length; rank++) {
		rankByMode.set(sorted[rank], rank);
	}

	for (const { mode } of ranked) {
		if (mode.extensions) {
			for (const raw of mode.extensions.split("|")) {
				const pattern = raw.trim();
				if (!pattern) continue;
				if (pattern.startsWith("^")) {
					namedChecks.push({
						mode,
						exactName: pattern.slice(1).toLowerCase(),
					});
				} else {
					rememberFirst(extensions, pattern.toLowerCase(), mode);
				}
			}
		}

		for (const matcher of mode.filenameMatchers) {
			const exactName = exactNameFromRegex(matcher);
			if (exactName) {
				namedChecks.push({ mode, exactName });
				continue;
			}
			namedChecks.push({ mode, matcher });
		}
	}

	modeIndex = { sorted, namedChecks, extensions, rankByMode };
	return modeIndex;
}

function findModeByExtension(
	fileNameLower: string,
	extensions: Map<string, Mode>,
	rankByMode: Map<Mode, number>,
): Mode | undefined {
	let best: Mode | undefined;
	let bestRank = Number.POSITIVE_INFINITY;
	let dot = fileNameLower.indexOf(".");
	while (dot >= 0 && dot < fileNameLower.length - 1) {
		const mode = extensions.get(fileNameLower.slice(dot + 1));
		if (mode) {
			const rank = rankByMode.get(mode) ?? Number.POSITIVE_INFINITY;
			if (rank < bestRank) {
				best = mode;
				bestRank = rank;
			}
		}
		dot = fileNameLower.indexOf(".", dot + 1);
	}
	return best;
}

function resolveModeForPath(fileName: string): Mode {
	const fallback = modesByName.text;
	const index = getModeIndex();
	const fileNameLower = fileName.toLowerCase();

	for (const check of index.namedChecks) {
		if (check.exactName) {
			if (
				check.exactName === fileNameLower &&
				check.mode.supportsFile?.(fileName)
			) {
				return check.mode;
			}
			continue;
		}

		const matcher = check.matcher;
		if (!matcher) continue;
		matcher.lastIndex = 0;
		if (matcher.test(fileName) && check.mode.supportsFile?.(fileName)) {
			return check.mode;
		}
	}

	const byExtension = findModeByExtension(
		fileNameLower,
		index.extensions,
		index.rankByMode,
	);
	if (byExtension?.supportsFile?.(fileName)) return byExtension;

	for (const mode of index.sorted) {
		if (mode.supportsFile?.(fileName)) return mode;
	}

	return fallback;
}

function cacheResolvedMode(fileNameLower: string, mode: Mode): Mode {
	if (resolvedByFileName.size >= FILE_NAME_CACHE_LIMIT) {
		resolvedByFileName.clear();
	}
	resolvedByFileName.set(fileNameLower, mode);
	return mode;
}

/**
 * Get mode for file path
 */
export function getModeForPath(path: string): Mode {
	const fileName = fileNameFromPath(path);
	const cached = resolvedByFileName.get(fileName);
	if (cached) return cached;

	return cacheResolvedMode(fileName, resolveModeForPath(fileName));
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

export function getMode(name: string): Mode | null {
	return modesByName[normalizeModeKey(name)] || null;
}

export class Mode {
	extensions: string;
	caption: string;
	name: string;
	mode: string;
	aliases: string[];
	extRe: RegExp | null;
	filenameMatchers: RegExp[];
	languageExtension: LanguageExtensionProvider | null;

	constructor(
		name: string,
		caption: string | undefined,
		extensions: string | string[],
		languageExtension: LanguageExtensionProvider | null = null,
		options: AddModeOptions = {},
	) {
		if (Array.isArray(extensions)) {
			extensions = extensions.join("|");
		}

		this.name = name;
		this.mode = name; // CodeMirror uses different mode naming
		this.extensions = extensions;
		this.caption = caption || this.name.replace(/_/g, " ");
		this.aliases = normalizeAliases(options.aliases, this.name);
		this.filenameMatchers = Array.isArray(options.filenameMatchers)
			? options.filenameMatchers.filter((matcher) => matcher instanceof RegExp)
			: [];
		this.languageExtension = languageExtension;
		let re = "";

		if (!extensions) {
			this.extRe = null;
			return;
		}

		const patterns = extensions
			.split("|")
			.map((pattern) => pattern.trim())
			.filter(Boolean);
		const filenamePatterns = patterns
			.filter((pattern) => pattern.startsWith("^"))
			.map((pattern) => `^${escapeRegExp(pattern.slice(1))}$`);
		const extensionPatterns = patterns
			.filter((pattern) => !pattern.startsWith("^"))
			.map((pattern) => escapeRegExp(pattern));
		const regexParts: string[] = [];

		if (extensionPatterns.length) {
			regexParts.push(`^.*?\\.(${extensionPatterns.join("|")})$`);
		}

		regexParts.push(...filenamePatterns);

		if (!regexParts.length) {
			this.extRe = null;
			return;
		}

		re =
			regexParts.length === 1 ? regexParts[0] : `(?:${regexParts.join("|")})`;
		this.extRe = new RegExp(re, "i");
	}

	supportsFile(filename: string): boolean {
		if (this.extRe?.test(filename)) return true;

		return this.filenameMatchers.some((matcher) => {
			matcher.lastIndex = 0;
			return matcher.test(filename);
		});
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

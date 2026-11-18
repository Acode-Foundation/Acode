import fsOperation from "fileSystem";
import Uri from "utils/Uri";
import Url from "utils/Url";
import {
	EXTENSIONS_FILE,
	MAX_EXTENSIONS_FILE_SIZE,
	NO_RECOMMENDATIONS,
	parseExtensionRecommendations,
	sameRecommendations,
	unusableRecommendations,
} from "./workspaceExtensions";
import {
	MAX_SETTINGS_SIZE,
	NO_PROJECT_SETTINGS,
	parseProjectSettings,
	SETTINGS_FILE,
	sameProjectSettings,
	unusableProjectSettings,
} from "./workspaceSettings";

/** Name of the directory that holds a project's Acode configuration. */
export const WORKSPACE_DIR = ".acode";

/**
 * @typedef {object} Workspace
 * @property {string} url Url of the project root folder.
 * @property {string} name Name the root was opened with.
 * @property {string} configUrl Url of the root's `.acode` directory.
 * @property {import("./workspaceSettings").ProjectSettings} settings What the
 * project's `settings.json` says. Has no values when the file is missing.
 * @property {import("./workspaceExtensions").ExtensionRecommendations} extensions
 * What the project's `extensions.json` recommends. Has none when the file is missing.
 */

/**
 * @typedef {"open"|"settings"|"extensions"|"close"} WorkspaceEvent
 * "open": a root with a `.acode` directory was recognised.
 * "settings": a recognised root's settings changed.
 * "extensions": a recognised root's plugin recommendations changed.
 * "close": a recognised root was closed, or lost its `.acode` directory.
 * Listeners receive the {@link Workspace}; for "settings" that is the new
 * state, for "close" the state it had when it went away.
 */

/** Open roots, configured or not, by url. @type {Map<string, string>} */
const roots = new Map();
/** Roots that have a `.acode` directory, by url. @type {Map<string, Workspace>} */
const workspaces = new Map();
/**
 * The scan currently running for each root. A scan whose token is no longer
 * here was superseded (or its root closed) and must not touch the registry.
 * @type {Map<string, symbol>}
 */
const scans = new Map();
/** @type {Record<WorkspaceEvent, Set<Function>>} */
const listeners = {
	open: new Set(),
	settings: new Set(),
	extensions: new Set(),
	close: new Set(),
};

let stopListening = null;

/**
 * Write a url in a form that can be compared with other urls of the same
 * storage. A folder added through Android's storage picker has a bare tree url
 * (`content://.../tree/primary%3AProjects%2Fapp`), but the files inside it are
 * `<tree url>::<document id>`, so as plain strings the folder is never a
 * prefix of its own files. Content urls are therefore always written as
 * `<tree url>::<document id>`, the form openFolder compares in. Any other url,
 * including a content url that is not from a documents provider, is returned
 * as it is.
 * @param {string} url
 * @returns {string}
 */
function comparable(url) {
	if (typeof url !== "string" || Url.getProtocol(url) !== "content:") {
		return url;
	}
	try {
		let { url: bare } = Url.parse(url);
		if (bare.endsWith("/")) bare = bare.slice(0, -1);
		const { rootUri, docId } = Uri.parse(bare);
		return Uri.format(rootUri, docId);
	} catch (error) {
		return url;
	}
}

/**
 * Whether `url` is `parent` or is inside it, whichever shape each has.
 * @param {string} url
 * @param {string} parent
 * @returns {boolean}
 */
function isInside(url, parent) {
	return Url.isSameOrDescendant(comparable(url), comparable(parent));
}

/**
 * Locate the `.acode` directory of a project root.
 * A `.acode` that is a file, or anything that cannot be stat'ed (missing,
 * unreadable, offline server), means the root has no workspace configuration.
 * @param {string} rootUrl
 * @returns {Promise<string|null>} Url of the `.acode` directory, or null
 */
export async function detectConfigDir(rootUrl) {
	try {
		const configUrl = Url.join(rootUrl, WORKSPACE_DIR);
		if (!configUrl) return null;
		const stat = await fsOperation(configUrl)?.stat();
		return stat?.isDirectory ? configUrl : null;
	} catch (error) {
		return null;
	}
}

/**
 * Read one of the files in `.acode`. Those files are optional, so a missing or
 * unreadable one is never an error: it just means the project says nothing.
 * @param {string} configUrl
 * @param {string} fileName
 * @param {number} maxSize
 * @returns {Promise<{text: string}|{tooLarge: true}|null>} null when there is nothing to read
 */
async function readConfigFile(configUrl, fileName, maxSize) {
	try {
		const fs = fsOperation(Url.join(configUrl, fileName));
		const stat = await fs?.stat();
		if (!stat?.isFile) return null;
		if (stat.size > maxSize) return { tooLarge: true };
		return { text: await fs.readFile("utf8") };
	} catch (error) {
		return null;
	}
}

const tooLarge = (maxSize) => `File is larger than ${maxSize / 1024} KB`;

/**
 * @param {string} configUrl
 * @returns {Promise<import("./workspaceSettings").ProjectSettings>}
 */
async function loadSettings(configUrl) {
	const file = await readConfigFile(
		configUrl,
		SETTINGS_FILE,
		MAX_SETTINGS_SIZE,
	);
	if (!file) return NO_PROJECT_SETTINGS;
	if (file.tooLarge) {
		return unusableProjectSettings(tooLarge(MAX_SETTINGS_SIZE));
	}
	return parseProjectSettings(file.text);
}

/**
 * @param {string} configUrl
 * @returns {Promise<import("./workspaceExtensions").ExtensionRecommendations>}
 */
async function loadExtensions(configUrl) {
	const file = await readConfigFile(
		configUrl,
		EXTENSIONS_FILE,
		MAX_EXTENSIONS_FILE_SIZE,
	);
	if (!file) return NO_RECOMMENDATIONS;
	if (file.tooLarge) {
		return unusableRecommendations(tooLarge(MAX_EXTENSIONS_FILE_SIZE));
	}
	return parseExtensionRecommendations(file.text);
}

/**
 * @param {WorkspaceEvent} event
 * @param {Workspace} workspace
 */
function emit(event, workspace) {
	for (const listener of [...listeners[event]]) {
		try {
			listener(workspace);
		} catch (error) {
			console.error(`Workspace "${event}" listener failed:`, error);
		}
	}
}

/**
 * Check a root for a `.acode` directory and update the registry.
 * @param {string} url
 * @returns {Promise<Workspace|null>}
 */
async function scan(url) {
	const token = Symbol(url);
	scans.set(url, token);

	const configUrl = await detectConfigDir(url);
	const [settings, extensions] = configUrl
		? await Promise.all([loadSettings(configUrl), loadExtensions(configUrl)])
		: [null, null];

	// The root was closed or rescanned while we were waiting on the file system.
	if (scans.get(url) !== token) return workspaces.get(url) ?? null;
	scans.delete(url);

	const existing = workspaces.get(url);

	if (!configUrl) {
		if (existing) {
			workspaces.delete(url);
			emit("close", existing);
		}
		return null;
	}

	const settingsChanged =
		!existing || !sameProjectSettings(existing.settings, settings);
	const extensionsChanged =
		!existing || !sameRecommendations(existing.extensions, extensions);
	if (!settingsChanged && !extensionsChanged) return existing;

	/** @type {Workspace} */
	const workspace = Object.freeze({
		url,
		name: roots.get(url),
		configUrl,
		settings,
		extensions,
	});
	workspaces.set(url, workspace);

	if (!existing) {
		emit("open", workspace);
	} else {
		if (settingsChanged) emit("settings", workspace);
		if (extensionsChanged) emit("extensions", workspace);
	}
	return workspace;
}

/**
 * @param {{url: string, name?: string}} folder
 */
function onAddFolder({ url, name } = {}) {
	if (!url || roots.has(url)) return;
	roots.set(url, name);
	scan(url).catch((error) => {
		console.error(`Failed to scan workspace "${url}":`, error);
	});
}

/**
 * @param {{url: string}} folder
 */
function onRemoveFolder({ url } = {}) {
	if (!url || !roots.delete(url)) return;
	scans.delete(url);

	const workspace = workspaces.get(url);
	if (!workspace) return;
	workspaces.delete(url);
	emit("close", workspace);
}

/**
 * Saving a file inside a root's `.acode` directory changes what is in it, so
 * look at that root again. This is what makes edits to `settings.json` take
 * effect right away, and notices a `.acode` directory that was just created.
 * @param {{uri?: string}} file
 */
function onSaveFile(file) {
	const uri = file?.uri;
	if (!uri) return;

	for (const root of roots.keys()) {
		let configUrl;
		try {
			configUrl = Url.join(root, WORKSPACE_DIR);
		} catch (error) {
			continue;
		}
		if (!configUrl || !isInside(uri, configUrl)) continue;
		scan(root).catch((error) => {
			console.error(`Failed to scan workspace "${root}":`, error);
		});
	}
}

/**
 * Start tracking workspaces. Call once the editor manager exists and before
 * saved folders are restored, so those are recognised as well.
 * Calling it again restarts tracking from scratch.
 * @param {object} manager Emits "add-folder", "remove-folder" and "save-file" like editorManager.
 * @param {Array<{url: string, title?: string, name?: string}>} [openFolders]
 * Folders that are already open.
 * @returns {() => void} Stops tracking and forgets every workspace.
 */
export function init(manager, openFolders = []) {
	stopListening?.();

	manager.on("add-folder", onAddFolder);
	manager.on("remove-folder", onRemoveFolder);
	manager.on("save-file", onSaveFile);

	stopListening = () => {
		manager.off("add-folder", onAddFolder);
		manager.off("remove-folder", onRemoveFolder);
		manager.off("save-file", onSaveFile);
		roots.clear();
		workspaces.clear();
		scans.clear();
		stopListening = null;
	};

	for (const { url, title, name } of openFolders) {
		onAddFolder({ url, name: name ?? title });
	}

	return stopListening;
}

/**
 * Get the workspace of a project root.
 * @param {string} rootUrl
 * @returns {Workspace|null}
 */
export function get(rootUrl) {
	return workspaces.get(rootUrl) ?? null;
}

/**
 * Find the workspace a file or folder belongs to. When roots are nested, the
 * innermost configured one wins.
 * @param {string} url
 * @returns {Workspace|null}
 */
export function find(url) {
	if (!url) return null;
	const target = comparable(url);
	let match = null;
	let matchRoot = "";
	for (const workspace of workspaces.values()) {
		// Depth is judged on the comparable form: raw urls of the same project
		// can differ in length by shape alone.
		const root = comparable(workspace.url);
		if (!Url.isSameOrDescendant(target, root)) continue;
		if (!match || root.length > matchRoot.length) {
			match = workspace;
			matchRoot = root;
		}
	}
	return match;
}

/**
 * The settings the project overrides for a file or folder: those of the
 * innermost workspace it belongs to, or none when it is in no workspace.
 * The result is frozen and is never the user's global settings.
 * @param {string} url
 * @returns {Readonly<Record<string, any>>}
 */
export function getSettings(url) {
	return (find(url) ?? { settings: NO_PROJECT_SETTINGS }).settings.values;
}

/**
 * Combine a set of settings with the overrides of the project a file is in.
 * Returns `base` itself when the file has no overrides, so files outside any
 * project behave exactly as before. Otherwise returns a new object and leaves
 * `base` alone: the user's global settings are never modified.
 * @template {object} T
 * @param {T} base Usually the user's settings.
 * @param {string} [url] The file the settings are for.
 * @returns {T}
 */
export function resolveSettings(base, url) {
	const overrides = getSettings(url);
	return Object.keys(overrides).length ? { ...base, ...overrides } : base;
}

/**
 * All configured workspaces that are currently open.
 * @returns {Workspace[]}
 */
export function list() {
	return [...workspaces.values()];
}

/**
 * Tell the workspaces that something was created, deleted, renamed, moved or
 * pasted at these urls (the old and the new url of a rename or move, both).
 * Every open root whose `.acode` directory is, is inside, or is under one of
 * them is checked again, so a deleted or renamed `settings.json` stops
 * applying and a new one starts to. Other roots are left alone.
 * @param {...string} urls
 */
export function pathsChanged(...urls) {
	const changed = urls.filter(Boolean);
	if (!changed.length) return;

	for (const root of roots.keys()) {
		let configUrl;
		try {
			configUrl = Url.join(root, WORKSPACE_DIR);
		} catch (error) {
			continue;
		}
		if (!configUrl) continue;

		const affected = changed.some(
			(url) => isInside(url, configUrl) || isInside(configUrl, url),
		);
		if (!affected) continue;
		scan(root).catch((error) => {
			console.error(`Failed to scan workspace "${root}":`, error);
		});
	}
}

/**
 * Check an open root again, e.g. after its `.acode` directory was created or
 * deleted. Does nothing for roots that are not open.
 * @param {string} rootUrl
 * @returns {Promise<Workspace|null>}
 */
export function refresh(rootUrl) {
	if (!roots.has(rootUrl)) return Promise.resolve(null);
	return scan(rootUrl);
}

/**
 * @param {WorkspaceEvent} event
 * @param {(workspace: Workspace) => void} listener
 */
export function on(event, listener) {
	listeners[event]?.add(listener);
}

/**
 * @param {WorkspaceEvent} event
 * @param {(workspace: Workspace) => void} listener
 */
export function off(event, listener) {
	listeners[event]?.delete(listener);
}

export default {
	WORKSPACE_DIR,
	init,
	get,
	find,
	getSettings,
	resolveSettings,
	list,
	refresh,
	pathsChanged,
	on,
	off,
};

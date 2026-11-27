/**
 * @typedef {Object} FileTypeHandler
 * @property {string} id - Unique identifier for the handler
 * @property {string[]} extensions - File extensions this handler supports (without dots)
 * @property {function} handleFile - Function that handles the file
 */

/**
 * @typedef {Object} FileInfo
 * @property {string} name - File name
 * @property {string} uri - File URI
 * @property {Object} stats - File stats
 * @property {boolean} readOnly - Whether the file is read-only
 * @property {Object} options - Additional options passed during file open
 */

const HANDLED_EXTENSIONS_KEY = "pluginHandledExtensions";

class FileTypeHandlerRegistry {
	#handlers = new Map();

	/**
	 * Register a file type handler
	 * @param {string} id - Unique identifier for the handler
	 * @param {Object} options - Handler options
	 * @param {string[]} options.extensions - File extensions to handle (without dots)
	 * @param {function(FileInfo): Promise<void>} options.handleFile - Async function to handle the file
	 * @throws {Error} If id is already registered or required options are missing
	 */
	registerFileHandler(id, { extensions, handleFile }) {
		if (this.#handlers.has(id)) {
			throw new Error(`Handler with id '${id}' is already registered`);
		}

		if (!extensions?.length) {
			throw new Error("extensions array is required");
		}

		if (typeof handleFile !== "function") {
			throw new Error("handleFile function is required");
		}

		// Normalize extensions (remove dots if present, convert to lowercase)
		const normalizedExts = extensions.map((ext) =>
			ext.toLowerCase().replace(/^\./, ""),
		);

		this.#handlers.set(id, {
			extensions: normalizedExts,
			handleFile,
		});
		rememberHandledExtensions(normalizedExts);
	}

	/**
	 * Whether a plugin has registered a handler for this file name in any
	 * session, so opening it should wait until plugins have loaded. Extensions
	 * are never forgotten, which only means waiting as before. Until a full
	 * plugin load has recorded them, every file may have a handler.
	 * @param {string} filename
	 */
	mayHavePluginHandler(filename) {
		const extensions = readHandledExtensions();
		if (!extensions) return true;
		const ext = filename.split(".").pop().toLowerCase();
		return extensions.includes("*") || extensions.includes(ext);
	}

	/**
	 * Marks the handled extensions as known. Call it after a full plugin load,
	 * once every installed plugin has had the chance to register handlers.
	 */
	markHandledExtensionsKnown() {
		const registered = [...this.#handlers.values()].flatMap(
			(handler) => handler.extensions,
		);
		writeHandledExtensions([...(readHandledExtensions() ?? []), ...registered]);
	}

	/**
	 * Unregister a file type handler
	 * @param {string} id - The handler id to remove
	 */
	unregisterFileHandler(id) {
		this.#handlers.delete(id);
	}

	/**
	 * Get a file handler for a given filename
	 * @param {string} filename
	 * @returns {Object|null} The matching handler or null if none found
	 */
	getFileHandler(filename) {
		const ext = filename.split(".").pop().toLowerCase();

		for (const [id, handler] of this.#handlers) {
			if (
				handler.extensions.includes(ext) ||
				handler.extensions.includes("*")
			) {
				return {
					id,
					...handler,
				};
			}
		}

		return null;
	}

	/**
	 * Get all registered handlers
	 * @returns {Map} Map of all registered handlers
	 */
	getHandlers() {
		return new Map(this.#handlers);
	}
}

export const fileTypeHandler = new FileTypeHandlerRegistry();
export default fileTypeHandler;

/**
 * @returns {string[] | null} null until a full plugin load has recorded them
 */
function readHandledExtensions() {
	try {
		const extensions = JSON.parse(localStorage.getItem(HANDLED_EXTENSIONS_KEY));
		return Array.isArray(extensions) ? extensions : null;
	} catch {
		return null;
	}
}

/**
 * Adds extensions to the history. Before the first full plugin load the
 * history is left unset; markHandledExtensionsKnown records everything then.
 */
function rememberHandledExtensions(extensions) {
	const known = readHandledExtensions();
	if (!known || extensions.every((ext) => known.includes(ext))) return;
	writeHandledExtensions([...known, ...extensions]);
}

function writeHandledExtensions(extensions) {
	try {
		localStorage.setItem(
			HANDLED_EXTENSIONS_KEY,
			JSON.stringify([...new Set(extensions)]),
		);
	} catch (error) {
		console.warn("Unable to remember plugin file handlers", error);
	}
}

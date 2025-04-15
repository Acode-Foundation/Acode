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

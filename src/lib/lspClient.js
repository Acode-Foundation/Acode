import { AceLanguageClient } from "ace-linters/build/ace-language-client";
import settings from "./settings";

export default class lspClient {
	constructor(wsUrl, modes, initializationOptions = {}) {
		this.wsUrl = wsUrl;
		// Convert modes array to string if needed, or keep as string
		this.modes = Array.isArray(modes) ? modes.join(",") : modes;
		this.socket = null;
		this.languageProvider = null;
		this.registeredEditors = new Set();
		this.initializationOptions = initializationOptions;
		this.isConnected = false;
	}

	/**
	 * Connect to the LSP server
	 * @returns {Promise<void>}
	 */
	async connect() {
		if (this.isConnected) {
			console.warn("LSP client is already connected");
			return;
		}

		try {
			// Create WebSocket connection
			this.socket = new WebSocket(this.wsUrl);

			// Set up WebSocket event handlers
			this.socket.onopen = () => {
				console.log("LSP WebSocket connected");
				this.isConnected = true;
				this.reconnectAttempts = 0;
				this._initializeLanguageProvider();
			};

			this.socket.onclose = (event) => {
				console.log("LSP WebSocket disconnected", event);
				this.isConnected = false;
			};

			this.socket.onerror = (error) => {
				console.error("LSP WebSocket error:", error);
				this.isConnected = false;
			};

			// Wait for connection to be established
			await this._waitForConnection();
		} catch (error) {
			console.error("Failed to connect to LSP server:", error);
			throw error;
		}
	}

	/**
	 * Disconnect from the LSP server
	 */
	disconnect() {
		if (!this.isConnected) {
			console.warn("LSP client is not connected");
			return;
		}

		try {
			// Remove all registered editors
			this.registeredEditors.forEach((editor) => {
				this.removeEditor(editor);
			});

			// Clean up language provider
			if (this.languageProvider) {
				this.languageProvider.dispose?.();
				this.languageProvider = null;
			}

			// Close WebSocket connection
			if (this.socket) {
				this.socket.close();
				this.socket = null;
			}

			this.isConnected = false;
			console.log("LSP client disconnected");
		} catch (error) {
			console.error("Error during disconnect:", error);
		}
	}

	/**
	 * Add an editor to the language provider
	 * @param {Object} editor - Ace editor instance
	 * @returns {boolean} - Success status
	 * 
	 * Note: this is not limited to a single editor tab
	 */
	addEditor(editor) {
		if (!editor) {
			console.error("Editor is required");
			return false;
		}

		if (this.registeredEditors.has(editor)) {
			console.warn("Editor is already registered");
			return true;
		}

		if (!this.isConnected || !this.languageProvider) {
			console.error("LSP client is not connected. Call connect() first.");
			return false;
		}

		try {
			settings.update({
				showAnnotations: true,
			});
			this.languageProvider.registerEditor(editor);
			this.registeredEditors.add(editor);

			const session = editor.getSession();
			session.on("changeAnnotation", () => {
				editor.renderer.updateBackMarkers();
			});
			console.log("Editor registered with LSP client");
			return true;
		} catch (error) {
			console.error("Failed to register editor:", error);
			return false;
		}
	}

	/**
	 * Remove an editor from the language provider
	 * @param {Object} editor - Ace editor instance
	 * @returns {boolean} - Success status
	 */
	removeEditor(editor) {
		if (!editor) {
			console.error("Editor is required");
			return false;
		}

		if (!this.registeredEditors.has(editor)) {
			console.warn("Editor is not registered");
			return true;
		}

		try {
			// Unregister from language provider if available
			if (this.languageProvider && this.languageProvider.unregisterEditor) {
				this.languageProvider.unregisterEditor(editor);
			}

			this.registeredEditors.delete(editor);
			console.log("Editor unregistered from LSP client");
			return true;
		} catch (error) {
			console.error("Failed to unregister editor:", error);
			return false;
		}
	}

	/**
	 *
	 * This method sends a request to the LSP server to change the current workspace folder.
	 * The server must have access to the specified `uri`.
	 *
	 * ⚠️ Note:
	 * - The LSP server must be running and connected before calling this method.
	 * - Android SAF (`content://`) URIs are not supported — use a file system–accessible path instead.
	 *
	 * @async
	 * @param {string} uri - The URI of the workspace folder to set (e.g., "file:///path/to/folder").
	 * @returns {Promise<boolean>} Resolves to `true` if the operation was successful, otherwise `false`.
	 */
	async setWorkspaceFolder(uri) {
		if (!this.languageProvider) {
			console.error(
				"Language provider not initialized. Connect to the LSP server first.",
			);
			return false;
		}

		try {
			await this.languageProvider.changeWorkspaceFolder(uri);
		} catch (error) {
			console.error("Error setting workspace folder:", error);
			return false;
		}
	}

	/**
	 * Format the current document or selection
	 * @param {Object} editor - Ace editor instance
	 * @param {Object} [range] - Formatting range (optional)
	 * @returns {Promise<boolean>}
	 */
	async formatDocument(editor, range) {
		if (!this.isConnected || !this.languageProvider) return false;

		try {
			await this.languageProvider.format(editor, range);
			return true;
		} catch (error) {
			console.error("Formatting failed:", error);
			return false;
		}
	}

	/**
	 * Get hover information at current cursor position
	 * @param {Object} editor - Ace editor instance
	 * @returns {Promise<Object|null>}
	 */
	async getHoverInfo(editor) {
		if (!this.isConnected || !this.languageProvider) return null;

		const session = editor.getSession();
		const cursor = editor.getCursorPosition();

		try {
			return await this.languageProvider.doHover(session, cursor);
		} catch (error) {
			console.error("Hover request failed:", error);
			return null;
		}
	}

	/**
	 * Go to definition of symbol at cursor
	 * @param {Object} editor - Ace editor instance
	 * @returns {Promise<Object|null>} Location of definition
	 */
	async goToDefinition(editor, uri) {
		if (!this.isConnected || !this.languageProvider?.client) return null;

		const session = editor.getSession();
		const cursor = editor.getCursorPosition();

		try {
			return await this.languageProvider.sendRequest(
				"textDocument/definition",
				{
					textDocument: { uri },
					position: { line: cursor.row, character: cursor.column },
				},
			);
		} catch (error) {
			console.error("Go to definition failed:", error);
			return null;
		}
	}

	/**
	 * Find references to symbol at cursor
	 * @param {Object} editor - Ace editor instance
	 * @returns {Promise<Array|null>} Reference locations
	 */
	async findReferences(editor, uri) {
		if (!this.isConnected || !this.languageProvider?.client) return null;

		const session = editor.getSession();
		const cursor = editor.getCursorPosition();

		try {
			return await this.languageProvider.sendRequest(
				"textDocument/references",
				{
					textDocument: { uri },
					position: { line: cursor.row, character: cursor.column },
					context: { includeDeclaration: true },
				},
			);
		} catch (error) {
			console.error("Find references failed:", error);
			return null;
		}
	}

	/**
	 * Get the current connection status
	 * @returns {boolean}
	 */
	isConnectedToServer() {
		return (
			this.isConnected &&
			this.socket &&
			this.socket.readyState === WebSocket.OPEN
		);
	}

	/**
	 * Get the list of registered editors
	 * @returns {Set<Object>}
	 */
	getRegisteredEditors() {
		return new Set(this.registeredEditors);
	}

	async sendRequest(method, params) {
		return new Promise((resolve, reject) => {
			try {
				this.languageProvider.sendRequest(
					"lspClient",
					method,
					params,
					(result) => {
						resolve(result);
					}
				);
			} catch (err) {
				reject(err);
			}
		});
	}

	async getDefination(editor, uri) {
		const result = await this.sendRequest("textDocument/definition", {
			textDocument: { uri },
			position: {
				line: editor.getCursorPosition().row,
				character: editor.getCursorPosition().column,
			},
		});

		return result;
	}


	// Private helper methods

	/**
	 * Initialize the language provider after connection is established
	 * @private
	 */
	_initializeLanguageProvider() {
		const serverData = {
			module: () => import("ace-linters/build/language-client"),
			modes: this.modes,
			type: "socket",
			socket: this.socket,
			serviceName: "lspClient",
			initializationOptions: this.initializationOptions,
		};

		try {
			this.languageProvider = AceLanguageClient.for(
				serverData,
				this.initializationOptions,
			);
			console.log("Language provider initialized");
		} catch (error) {
			console.error("Failed to initialize language provider:", error);
			throw error;
		}
	}

	/**
	 * Wait for WebSocket connection to be established
	 * @private
	 * @returns {Promise<void>}
	 */
	_waitForConnection() {
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				reject(new Error("Connection timeout"));
			}, 10000); // 10 second timeout

			if (this.socket.readyState === WebSocket.OPEN) {
				clearTimeout(timeout);
				resolve();
			} else {
				this.socket.addEventListener("open", () => {
					clearTimeout(timeout);
					resolve();
				});

				this.socket.addEventListener("error", (error) => {
					clearTimeout(timeout);
					reject(error);
				});
			}
		});
	}
}

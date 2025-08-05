import { AceLanguageClient } from "ace-linters/build/ace-language-client";

export default class lspClient {
	constructor(wsUrl, modes) {
		this.wsUrl = wsUrl;
		// Convert modes array to string if needed, or keep as string
		this.modes = Array.isArray(modes) ? modes.join(',') : modes;
		this.socket = null;
		this.languageProvider = null;
		this.registeredEditors = new Set();
		this.isConnected = false;
	}

	/**
	 * Connect to the LSP server
	 * @returns {Promise<void>}
	 */
	async connect() {
		if (this.isConnected) {
			console.warn('LSP client is already connected');
			return;
		}

		try {
			// Create WebSocket connection
			this.socket = new WebSocket(this.wsUrl);

			// Set up WebSocket event handlers
			this.socket.onopen = () => {
				console.log('LSP WebSocket connected');
				this.isConnected = true;
				this.reconnectAttempts = 0;
				this._initializeLanguageProvider();
			};

			this.socket.onclose = (event) => {
				console.log('LSP WebSocket disconnected', event);
				this.isConnected = false;
			};

			this.socket.onerror = (error) => {
				console.error('LSP WebSocket error:', error);
				this.isConnected = false;
			};

			// Wait for connection to be established
			await this._waitForConnection();
		} catch (error) {
			console.error('Failed to connect to LSP server:', error);
			throw error;
		}
	}

	/**
	 * Disconnect from the LSP server
	 */
	disconnect() {
		if (!this.isConnected) {
			console.warn('LSP client is not connected');
			return;
		}

		try {
			// Remove all registered editors
			this.registeredEditors.forEach(editor => {
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
			console.log('LSP client disconnected');
		} catch (error) {
			console.error('Error during disconnect:', error);
		}
	}

	/**
	 * Add an editor to the language provider
	 * @param {Object} editor - Ace editor instance
	 * @returns {boolean} - Success status
	 */
	addEditor(editor) {
		if (!editor) {
			console.error('Editor is required');
			return false;
		}

		if (this.registeredEditors.has(editor)) {
			console.warn('Editor is already registered');
			return true;
		}

		if (!this.isConnected || !this.languageProvider) {
			console.error('LSP client is not connected. Call connect() first.');
			return false;
		}

		try {

			this.languageProvider.registerEditor(editor);
			this.registeredEditors.add(editor);

			const session = editor.getSession();
			session.on('changeAnnotation', () => {
				editor.renderer.updateBackMarkers();
			});
			console.log('Editor registered with LSP client');
			return true;
		} catch (error) {
			console.error('Failed to register editor:', error);
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
			console.error('Editor is required');
			return false;
		}

		if (!this.registeredEditors.has(editor)) {
			console.warn('Editor is not registered');
			return true;
		}

		try {
			// Unregister from language provider if available
			if (this.languageProvider && this.languageProvider.unregisterEditor) {
				this.languageProvider.unregisterEditor(editor);
			}

			this.registeredEditors.delete(editor);
			console.log('Editor unregistered from LSP client');
			return true;
		} catch (error) {
			console.error('Failed to unregister editor:', error);
			return false;
		}
	}

	/**
	 * Get the current connection status
	 * @returns {boolean}
	 */
	isConnectedToServer() {
		return this.isConnected && this.socket && this.socket.readyState === WebSocket.OPEN;
	}

	/**
	 * Get the list of registered editors
	 * @returns {Set<Object>}
	 */
	getRegisteredEditors() {
		return new Set(this.registeredEditors);
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
		};

		try {
			this.languageProvider = AceLanguageClient.for(serverData);
			console.log('Language provider initialized');
		} catch (error) {
			console.error('Failed to initialize language provider:', error);
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
				reject(new Error('Connection timeout'));
			}, 10000); // 10 second timeout

			if (this.socket.readyState === WebSocket.OPEN) {
				clearTimeout(timeout);
				resolve();
			} else {
				this.socket.addEventListener('open', () => {
					clearTimeout(timeout);
					resolve();
				});

				this.socket.addEventListener('error', (error) => {
					clearTimeout(timeout);
					reject(error);
				});
			}
		});
	}
}

// Usage example:
/*
const client = new lspClient('ws://localhost:8080/lsp', ['javascript', 'typescript']);

// Connect to server
await client.connect();

// Add editors
const editor1 = editorManager.activeFile.session.$editor;
client.addEditor(editor1);

// Later, remove editor
client.removeEditor(editor1);

// Disconnect when done
client.disconnect();
*/
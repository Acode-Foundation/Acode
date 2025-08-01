export default class lspClient {
	constructor(serverUrl) {
		this.serverUrl = serverUrl;
		this.ws = null;
		this.messageId = 0;
		this.pendingRequests = new Map();

		// Map of editorId -> { editor, documentUri, language, version, changeHandler }
		this.editors = new Map();
	}

	// Establish WebSocket connection and initialize LSP
	connect() {
		this.ws = new WebSocket(this.serverUrl);
		this.ws.onopen = () => {
			this.initializeLSP();
		};
		this.ws.onmessage = (event) => this.handleMessage(event);
		this.ws.onerror = (error) => console.error("WebSocket error:", error);
		this.ws.onclose = () => console.log("WebSocket closed");
	}

	disconnect() {
		if (this.ws) {
			this.ws.close();
		}
	}

	initializeLSP() {
		const initParams = {
			processId: null,
			clientInfo: { name: "ace-lsp-client" },
			capabilities: {
				textDocument: {
					completion: { dynamicRegistration: false },
					publishDiagnostics: { relatedInformation: true },
				},
			},
		};
		this.sendRequest("initialize", initParams)
			.then(() => {
				this.sendNotification("initialized", {});
				// Open all already-registered editors
				for (const [id, meta] of this.editors) {
					this.sendDidOpen(id);
				}
			})
			.catch((error) => console.error("Initialization failed:", error));
	}

	// Add an editor/tab to share this single connection
	addEditor(id, editor, documentUri, language) {
		if (this.editors.has(id)) {
			console.warn(`Editor with id ${id} already registered; replacing.`);
			this.removeEditor(id);
		}

		const meta = {
			editor,
			documentUri,
			language,
			version: 1,
			changeHandler: null,
		};

		// change listener
		const changeHandler = () => {
			this.sendDidChange(id);
		};
		meta.changeHandler = changeHandler;
		editor.getSession().on("change", changeHandler);

		// completer for this editor
		editor.completers = editor.completers || [];
		editor.completers.push({
			getCompletions: (ed, session, pos, prefix, callback) => {
				this.requestCompletions(id, pos, prefix, callback);
			},
		});

		this.editors.set(id, meta);

		// If already initialized, immediately send didOpen
		this.sendDidOpen(id);
	}

	// Remove an editor/tab
	removeEditor(id) {
		const meta = this.editors.get(id);
		if (!meta) return;
		const { editor, changeHandler, documentUri } = meta;

		// Optionally notify the server that the document is closed
		this.sendNotification("textDocument/didClose", {
			textDocument: { uri: documentUri },
		});

		// Tear down listener
		if (changeHandler) {
			editor.getSession().removeListener("change", changeHandler);
		}

		// Note: removing completer is left to caller if needed
		this.editors.delete(id);
	}

	sendDidOpen(id) {
		const meta = this.editors.get(id);
		if (!meta) return;
		const { editor, documentUri, language, version } = meta;
		const params = {
			textDocument: {
				uri: documentUri,
				languageId: language,
				version,
				text: editor.getValue(),
			},
		};
		this.sendNotification("textDocument/didOpen", params);
	}

	sendDidChange(id) {
		const meta = this.editors.get(id);
		if (!meta) return;
		const { editor, documentUri } = meta;
		meta.version += 1;
		const params = {
			textDocument: {
				uri: documentUri,
				version: meta.version,
			},
			contentChanges: [{ text: editor.getValue() }],
		};
		this.sendNotification("textDocument/didChange", params);
	}

	requestCompletions(id, position, prefix, callback) {
		const meta = this.editors.get(id);
		if (!meta) {
			callback(null, []);
			return;
		}
		const { documentUri } = meta;
		const params = {
			textDocument: { uri: documentUri },
			position: { line: position.row, character: position.column },
		};
		this.sendRequest("textDocument/completion", params)
			.then((result) => {
				const completions = (result?.items || []).map((item) => ({
					caption: item.label,
					value: item.insertText || item.label,
					meta: item.detail || "completion",
				}));
				callback(null, completions);
			})
			.catch((error) => {
				console.error("Completion failed:", error);
				callback(null, []);
			});
	}

	sendRequest(method, params) {
		return new Promise((resolve, reject) => {
			if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
				reject(new Error("WebSocket not open"));
				return;
			}
			const id = ++this.messageId;
			const message = { jsonrpc: "2.0", id, method, params };
			this.pendingRequests.set(id, { resolve, reject });
			this.ws.send(JSON.stringify(message));
		});
	}

	sendNotification(method, params) {
		if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
		const message = { jsonrpc: "2.0", method, params };
		this.ws.send(JSON.stringify(message));
	}

	handleMessage(event) {
		let message;
		try {
			message = JSON.parse(event.data);
		} catch (e) {
			console.warn("Failed to parse LSP message", e);
			return;
		}

		if (message.id && this.pendingRequests.has(message.id)) {
			const { resolve, reject } = this.pendingRequests.get(message.id);
			if (message.error) {
				reject(message.error);
			} else {
				resolve(message.result);
			}
			this.pendingRequests.delete(message.id);
		} else if (message.method === "textDocument/publishDiagnostics") {
			this.handleDiagnostics(message.params);
		}
	}

	handleDiagnostics(params) {
		const diagnostics = params.diagnostics || [];
		const uri = params.uri || (params.textDocument && params.textDocument.uri);
		if (!uri) return;

		// Find all editors with that document URI
		for (const [, meta] of this.editors) {
			if (meta.documentUri === uri) {
				const annotations = diagnostics.map((d) => ({
					row: d.range.start.line,
					column: d.range.start.character,
					text: d.message,
					type: d.severity === 1 ? "error" : "warning",
				}));
				meta.editor.getSession().setAnnotations(annotations);
			}
		}
	}
}

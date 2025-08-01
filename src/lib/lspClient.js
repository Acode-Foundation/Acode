import "ace-linters";

export default class lspClient {
	constructor(serverUrl) {
		this.serverUrl = serverUrl;
		this.ws = null;
		this.messageId = 0;
		this.pendingRequests = new Map();
		this.editors = new Map(); // editorId -> { editor, documentUri, language, version }

		// Enable ace language tools
		ace.require("ace/ext/language_tools");
	}

	connect() {
		this.ws = new WebSocket(this.serverUrl);
		this.ws.onopen = () => this.initializeLSP();
		this.ws.onmessage = (event) => this.handleMessage(event);
		this.ws.onerror = (error) => console.error("WebSocket error:", error);
		this.ws.onclose = () => console.log("WebSocket closed");
	}

	disconnect() {
		this.ws?.close();
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
				// Open all registered editors
				for (const [id] of this.editors) {
					this.sendDidOpen(id);
				}
			})
			.catch((error) => console.error("Initialization failed:", error));
	}

	addEditor(id, editor, documentUri, language, mode) {
		if (this.editors.has(id)) {
			this.removeEditor(id);
		}

		// Setup ace-linters with mode
		const session = editor.getSession();

		session.setMode(mode);
		session.setUseWorker(true);

		// Enable autocompletion
		editor.setOptions({
			enableBasicAutocompletion: true,
			enableLiveAutocompletion: true,
			enableSnippets: false,
		});

		// Add LSP completer
		editor.completers = editor.completers || [];
		editor.completers.push({
			getCompletions: (ed, session, pos, prefix, callback) => {
				this.requestCompletions(id, pos, callback);
			},
		});

		// Track changes for LSP
		const changeHandler = () => this.sendDidChange(id);
		session.on("change", changeHandler);

		this.editors.set(id, {
			editor,
			documentUri,
			language,
			version: 1,
			changeHandler,
		});

		this.sendDidOpen(id);
	}

	removeEditor(id) {
		const meta = this.editors.get(id);
		if (!meta) return;

		// Clean up
		meta.editor.getSession().removeListener("change", meta.changeHandler);
		this.sendNotification("textDocument/didClose", {
			textDocument: { uri: meta.documentUri },
		});
		this.editors.delete(id);
	}

	sendDidOpen(id) {
		const meta = this.editors.get(id);
		if (!meta) return;

		this.sendNotification("textDocument/didOpen", {
			textDocument: {
				uri: meta.documentUri,
				languageId: meta.language,
				version: meta.version,
				text: meta.editor.getValue(),
			},
		});
	}

	sendDidChange(id) {
		const meta = this.editors.get(id);
		if (!meta) return;

		meta.version += 1;
		this.sendNotification("textDocument/didChange", {
			textDocument: {
				uri: meta.documentUri,
				version: meta.version,
			},
			contentChanges: [{ text: meta.editor.getValue() }],
		});
	}

	requestCompletions(id, position, callback) {
		const meta = this.editors.get(id);
		if (!meta) {
			callback(null, []);
			return;
		}

		const params = {
			textDocument: { uri: meta.documentUri },
			position: { line: position.row, character: position.column },
		};

		this.sendRequest("textDocument/completion", params)
			.then((result) => {
				const completions = (result?.items || []).map((item) => ({
					caption: item.label,
					value: item.insertText || item.label,
					meta: item.detail || "lsp",
				}));
				callback(null, completions);
			})
			.catch(() => callback(null, []));
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
		if (this.ws?.readyState === WebSocket.OPEN) {
			const message = { jsonrpc: "2.0", method, params };
			this.ws.send(JSON.stringify(message));
		}
	}

	handleMessage(event) {
		let message;
		try {
			message = JSON.parse(event.data);
		} catch (e) {
			console.warn("Failed to parse LSP message", e);
			return;
		}

		// Handle responses
		if (message.id && this.pendingRequests.has(message.id)) {
			const { resolve, reject } = this.pendingRequests.get(message.id);
			message.error ? reject(message.error) : resolve(message.result);
			this.pendingRequests.delete(message.id);
		}
		// Handle diagnostics - add to ace-linters annotations
		else if (message.method === "textDocument/publishDiagnostics") {
			this.handleDiagnostics(message.params);
		}
	}

	handleDiagnostics(params) {
		const diagnostics = params.diagnostics || [];
		const uri = params.uri;
		if (!uri) return;

		// Find editors with matching URI
		for (const [, meta] of this.editors) {
			if (meta.documentUri === uri) {
				const session = meta.editor.getSession();

				// Get existing ace-linters annotations
				const existing = session.getAnnotations() || [];
				const linterAnnotations = existing.filter((a) => a.source !== "lsp");

				// Add LSP diagnostics
				const lspAnnotations = diagnostics.map((d) => ({
					row: d.range.start.line,
					column: d.range.start.character,
					text: d.message,
					type: d.severity === 1 ? "error" : "warning",
					source: "lsp",
				}));

				// Combine and set
				session.setAnnotations([...linterAnnotations, ...lspAnnotations]);
			}
		}
	}
}

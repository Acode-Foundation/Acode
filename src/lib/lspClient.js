export default class lspClient {
    constructor({ serverUrl, editor, documentUri, language }) {
        this.editor = editor;
        this.documentUri = documentUri;
        this.serverUrl = serverUrl;
        this.ws = null;
        this.messageId = 0;
        this.pendingRequests = new Map();
        this.documentVersion = 1;
        this.currentLanguage = language;
    }


    // Establish WebSocket connection and initialize LSP
    connect() {
        this.ws = new WebSocket(this.serverUrl);
        this.ws.onopen = () => {
            this.initializeLSP();
        };
        this.ws.onmessage = (event) => this.handleMessage(event);
        this.ws.onerror = (error) => console.error('WebSocket error:', error);
        this.ws.onclose = () => console.log('WebSocket closed');

        // Listen to editor changes
        this.editor.getSession().on('change', (delta) => {
            this.sendDidChange();
        });

        // Add LSP completer for autocompletion
        this.editor.completers = this.editor.completers || [];
        this.editor.completers.push({
            getCompletions: (editor, session, pos, prefix, callback) => {
                this.requestCompletions(pos, prefix, callback);
            }
        });
    }

    // Disconnect from the LSP server
    disconnect() {
        if (this.ws) {
            this.ws.close();
        }
    }

    // Send initialize request to LSP server
    initializeLSP() {
        const initParams = {
            processId: null,
            clientInfo: { name: 'ace-lsp-client' },
            capabilities: {
                textDocument: {
                    completion: { dynamicRegistration: false },
                    publishDiagnostics: { relatedInformation: true }
                }
            }
        };
        this.sendRequest('initialize', initParams).then((result) => {
            this.sendNotification('initialized', {});
            this.sendDidOpen();
        }).catch((error) => console.error('Initialization failed:', error));
    }

    // Send textDocument/didOpen notification
    sendDidOpen() {
        const params = {
            textDocument: {
                uri: this.documentUri,
                languageId: this.currentLanguage,
                version: this.documentVersion,
                text: this.editor.getValue()
            }
        };
        this.sendNotification('textDocument/didOpen', params);
    }

    // Send textDocument/didChange notification
    sendDidChange() {
        const params = {
            textDocument: {
                uri: this.documentUri,
                version: ++this.documentVersion
            },
            contentChanges: [{ text: this.editor.getValue() }]
        };
        this.sendNotification('textDocument/didChange', params);
    }

    // Request completions from LSP server
    requestCompletions(position, prefix, callback) {
        const params = {
            textDocument: { uri: this.documentUri },
            position: { line: position.row, character: position.column }
        };
        this.sendRequest('textDocument/completion', params).then((result) => {
            const completions = (result?.items || []).map(item => ({
                caption: item.label,
                value: item.insertText || item.label,
                meta: item.detail || 'completion'
            }));
            callback(null, completions);
        }).catch((error) => {
            console.error('Completion failed:', error);
            callback(null, []);
        });
    }

    // Send a request and return a promise for the response
    sendRequest(method, params) {
        return new Promise((resolve, reject) => {
            const id = ++this.messageId;
            const message = { jsonrpc: '2.0', id, method, params };
            this.pendingRequests.set(id, { resolve, reject });
            this.ws.send(JSON.stringify(message));
        });
    }

    // Send a notification (no response expected)
    sendNotification(method, params) {
        const message = { jsonrpc: '2.0', method, params };
        this.ws.send(JSON.stringify(message));
    }

    // Handle incoming WebSocket messages
    handleMessage(event) {
        const message = JSON.parse(event.data);
        if (message.id && this.pendingRequests.has(message.id)) {
            const { resolve, reject } = this.pendingRequests.get(message.id);
            if (message.error) {
                reject(message.error);
            } else {
                resolve(message.result);
            }
            this.pendingRequests.delete(message.id);
        } else if (message.method === 'textDocument/publishDiagnostics') {
            this.handleDiagnostics(message.params);
        }
    }

    // Handle diagnostics from LSP server and display in editor
    handleDiagnostics(params) {
        const diagnostics = params.diagnostics || [];
        const annotations = diagnostics.map(d => ({
            row: d.range.start.line,
            column: d.range.start.character,
            text: d.message,
            type: d.severity === 1 ? 'error' : 'warning'
        }));
        this.editor.getSession().setAnnotations(annotations);

        // Optional: Update diagnostics list in HTML (assumes element exists)
        const diagnosticsList = document.getElementById('diagnosticsList');
        if (diagnosticsList) {
            diagnosticsList.innerHTML = diagnostics.map(d =>
                `<li>${d.message} at line ${d.range.start.line + 1}</li>`
            ).join('');
        }
    }
}
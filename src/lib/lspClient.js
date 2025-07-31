class lspClient {
    constructor(wsUrl) {
        this.wsUrl = wsUrl;
        this.ws = null;
        this.messageId = 0;
        this.pendingRequests = new Map();
        this.isInitialized = false;
        this.editor = null;
        this.currentLanguage = 'javascript';
        this.documentUri = 'file:///example.js';
        this.documentVersion = 0;
        this.currentMarkers = [];
    }

    connect() {
        return new Promise((resolve, reject) => {
            try {
                this.ws = new WebSocket(this.wsUrl);

                this.ws.onopen = () => {
                    console.log('WebSocket connected');
                    this.initialize().then(resolve).catch(reject);
                };

                this.ws.onmessage = (event) => {
                    this.handleMessage(JSON.parse(event.data));
                };

                this.ws.onclose = () => {
                    console.log('WebSocket closed');
                    this.updateStatus('disconnected', 'Disconnected from LSP server');
                    this.isInitialized = false;
                };

                this.ws.onerror = (error) => {
                    console.error('WebSocket error:', error);
                    this.updateStatus('error', 'WebSocket connection error');
                    reject(error);
                };
            } catch (error) {
                reject(error);
            }
        });
    }

    disconnect() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
            this.isInitialized = false;
        }

        // Clear diagnostics when disconnecting
        if (this.editor) {
            this.editor.getSession().clearAnnotations();
            this.clearMarkers();
        }
    }

    async initialize() {
        const initParams = {
            processId: null,
            clientInfo: {
                name: "ace-lsp-client",
                version: "1.0.0"
            },
            rootUri: null,
            capabilities: {
                textDocument: {
                    synchronization: {
                        dynamicRegistration: false,
                        willSave: false,
                        willSaveWaitUntil: false,
                        didSave: false
                    },
                    completion: {
                        dynamicRegistration: false,
                        completionItem: {
                            snippetSupport: true,
                            commitCharactersSupport: true
                        }
                    },
                    hover: {
                        dynamicRegistration: false,
                        contentFormat: ["markdown", "plaintext"]
                    },
                    publishDiagnostics: {
                        relatedInformation: true,
                        tagSupport: {
                            valueSet: [1, 2]
                        }
                    }
                },
                workspace: {
                    workspaceFolders: false,
                    configuration: false
                }
            }
        };

        try {
            await this.sendRequest('initialize', initParams);
            await this.sendNotification('initialized', {});
            this.isInitialized = true;
            this.updateStatus('connected', 'Connected to LSP server');

            // Open the document
            await this.didOpen();
        } catch (error) {
            throw new Error(`Failed to initialize LSP: ${error.message}`);
        }
    }

    sendRequest(method, params) {
        return new Promise((resolve, reject) => {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                reject(new Error('WebSocket not connected'));
                return;
            }

            const id = ++this.messageId;
            const message = {
                jsonrpc: '2.0',
                id: id,
                method: method,
                params: params
            };

            this.pendingRequests.set(id, { resolve, reject });
            this.ws.send(JSON.stringify(message));

            // Timeout after 30 seconds
            setTimeout(() => {
                if (this.pendingRequests.has(id)) {
                    this.pendingRequests.delete(id);
                    reject(new Error('Request timeout'));
                }
            }, 30000);
        });
    }

    sendNotification(method, params) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            console.warn('Cannot send notification: WebSocket not connected');
            return;
        }

        const message = {
            jsonrpc: '2.0',
            method: method,
            params: params
        };

        this.ws.send(JSON.stringify(message));
    }

    handleMessage(message) {
        if (message.id && this.pendingRequests.has(message.id)) {
            const { resolve, reject } = this.pendingRequests.get(message.id);
            this.pendingRequests.delete(message.id);

            if (message.error) {
                reject(new Error(message.error.message));
            } else {
                resolve(message.result);
            }
        } else if (message.method) {
            this.handleNotification(message.method, message.params);
        }
    }

    handleNotification(method, params) {
        switch (method) {
            case 'textDocument/publishDiagnostics':
                this.handleDiagnostics(params);
                break;
            default:
                console.log('Unhandled notification:', method, params);
        }
    }

    handleDiagnostics(params) {
        const diagnosticsDiv = document.getElementById('diagnosticsList');

        // Clear existing annotations and markers
        this.editor.getSession().clearAnnotations();
        this.clearMarkers();

        if (!params.diagnostics || params.diagnostics.length === 0) {
            diagnosticsDiv.innerHTML = 'No diagnostics available';
            return;
        }

        const annotations = [];
        const markers = [];
        let html = '';

        params.diagnostics.forEach(diagnostic => {
            const severity = ['', 'error', 'warning', 'info', 'hint'][diagnostic.severity] || 'info';
            const line = diagnostic.range.start.line;
            const col = diagnostic.range.start.character;
            const endLine = diagnostic.range.end.line;
            const endCol = diagnostic.range.end.character;

            // Add annotation for gutter icons (optional, you can remove this if you only want squiggly lines)
            annotations.push({
                row: line,
                column: col,
                text: diagnostic.message,
                type: severity === 'hint' ? 'info' : severity
            });

            // Add marker for squiggly underlines with LSP-specific classes
            const Range = ace.require('ace/range').Range;
            const range = new Range(line, col, endLine, endCol);
            const markerId = this.editor.getSession().addMarker(
                range,
                `ace_lsp_${severity}`,
                'text'
            );
            markers.push(markerId);

            html += `
                <div class="diagnostic-item diagnostic-${severity}">
                    <strong>Line ${line + 1}:${col + 1}</strong> - ${diagnostic.message}
                </div>
            `;
        });

        // Set annotations (gutter icons) - comment out this line if you don't want gutter icons
        this.editor.getSession().setAnnotations(annotations);

        // Store marker IDs for cleanup
        this.currentMarkers = markers;

        diagnosticsDiv.innerHTML = html;
    }

    clearMarkers() {
        if (this.currentMarkers) {
            this.currentMarkers.forEach(markerId => {
                this.editor.getSession().removeMarker(markerId);
            });
            this.currentMarkers = [];
        }
    }

    async didOpen() {
        if (!this.isInitialized) return;

        const params = {
            textDocument: {
                uri: this.documentUri,
                languageId: this.currentLanguage,
                version: ++this.documentVersion,
                text: this.editor.getValue()
            }
        };

        this.sendNotification('textDocument/didOpen', params);
    }

    async didChange(changes) {
        if (!this.isInitialized) return;

        const params = {
            textDocument: {
                uri: this.documentUri,
                version: ++this.documentVersion
            },
            contentChanges: [{
                text: this.editor.getValue()
            }]
        };

        this.sendNotification('textDocument/didChange', params);
    }

    async getCompletions(position) {
        if (!this.isInitialized) return [];

        try {
            const params = {
                textDocument: { uri: this.documentUri },
                position: {
                    line: position.row,
                    character: position.column
                }
            };

            const result = await this.sendRequest('textDocument/completion', params);
            const items = result?.items || result || [];

            return items.map(item => ({
                name: item.label,
                value: item.insertText || item.label,
                meta: item.kind ? this.getCompletionKindName(item.kind) : 'unknown',
                docHTML: item.documentation
            }));
        } catch (error) {
            console.warn('Completion request failed:', error);
            return [];
        }
    }

    getCompletionKindName(kind) {
        const kinds = {
            1: 'text', 2: 'method', 3: 'function', 4: 'constructor',
            5: 'field', 6: 'variable', 7: 'class', 8: 'interface',
            9: 'module', 10: 'property', 11: 'unit', 12: 'value',
            13: 'enum', 14: 'keyword', 15: 'snippet', 16: 'color',
            17: 'file', 18: 'reference'
        };
        return kinds[kind] || 'unknown';
    }

    setEditor(editor) {
        this.editor = editor;
    }

    setLanguage(language) {
        this.currentLanguage = language;
        // Update document URI based on language
        const extensions = {
            javascript: '.js',
            typescript: '.ts',
            python: '.py',
            java: '.java'
        };
        this.documentUri = `file:///example${extensions[language] || '.txt'}`;
    }

    updateStatus(type, message) {
        const statusDiv = document.getElementById('status');
        statusDiv.className = `status ${type}`;
        statusDiv.textContent = message;
    }
}

// Initialize Ace Editor
const editor = ace.edit("editor");
editor.setTheme("ace/theme/monokai");
editor.session.setMode("ace/mode/javascript");
editor.setOptions({
    enableBasicAutocompletion: true,
    enableLiveAutocompletion: true,
    enableSnippets: true,
    fontSize: 14
});

// Initialize LSP Client
let lspClient = null;

// Custom completer for LSP
const lspCompleter = {
    getCompletions: async function (editor, session, pos, prefix, callback) {
        if (!lspClient || !lspClient.isInitialized) {
            callback(null, []);
            return;
        }

        try {
            const completions = await lspClient.getCompletions(pos);
            callback(null, completions);
        } catch (error) {
            console.warn('LSP completion error:', error);
            callback(null, []);
        }
    }
};

// Add LSP completer
editor.completers = [lspCompleter];

// Handle text changes
let changeTimeout;
editor.on('change', () => {
    clearTimeout(changeTimeout);
    changeTimeout = setTimeout(() => {
        if (lspClient && lspClient.isInitialized) {
            lspClient.didChange();
        }
    }, 500); // Debounce for 500ms
});

// Event handlers
document.getElementById('connectBtn').addEventListener('click', async () => {
    const wsUrl = document.getElementById('wsUrl').value;
    if (!wsUrl) {
        alert('Please enter a WebSocket URL');
        return;
    }

    try {
        document.getElementById('connectBtn').disabled = true;
        lspClient = new LSPClient(wsUrl);
        lspClient.setEditor(editor);
        lspClient.setLanguage(document.getElementById('languageSelect').value);

        await lspClient.connect();

        document.getElementById('disconnectBtn').disabled = false;
    } catch (error) {
        alert(`Failed to connect: ${error.message}`);
        document.getElementById('connectBtn').disabled = false;
        lspClient = null;
    }
});

document.getElementById('disconnectBtn').addEventListener('click', () => {
    if (lspClient) {
        lspClient.disconnect();
        lspClient = null;
    }
    document.getElementById('connectBtn').disabled = false;
    document.getElementById('disconnectBtn').disabled = true;
});

document.getElementById('languageSelect').addEventListener('change', (e) => {
    const language = e.target.value;
    editor.session.setMode(`ace/mode/${language}`);

    if (lspClient) {
        lspClient.setLanguage(language);
        // Reopen document with new language
        lspClient.didOpen();
    }
});
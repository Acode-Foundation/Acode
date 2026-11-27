import XCTest
import WebKit

@MainActor
final class AlpineLspTests: BridgeTestCase {
    func testExistingJsonLanguageServerOverAlpine() async throws {
        let webView = try await editorWebView()
        let result = try await webView.callAsyncJavaScript(#"""
            if (!await Terminal.isInstalled() && !await Terminal.install()) throw new Error(Terminal.lastInstallError);
            await Executor.execute('command -v vscode-json-language-server >/dev/null || { apk add --no-cache nodejs npm && npm install -g --no-audit --no-fund vscode-langservers-extracted@4.10.0; }', true);
            const api = acode.require('lsp');
            const server = api.servers.get('json-stdio');
            const context = {serverId:'ios-json-test', uri:'alpine://localhost/tmp/acode-lsp.json', originalDocumentUri:'alpine://localhost/tmp/acode-lsp.json', rootUri:'alpine://localhost/tmp'};
            const provider = await api.runtimes.select(server, context);
            if (provider?.id !== 'builtin-alpine') throw new Error('Alpine provider not selected');
            const paths = provider.resolveUris(server, context);
            if (paths.documentUri !== 'file:///tmp/acode-lsp.json') throw new Error('Wrong guest URI');
            const connection = await provider.start(server, context);
            const handle = connection.transport;
            const messages = [];
            handle.transport.subscribe(text => messages.push(JSON.parse(text)));
            const send = message => handle.transport.send(JSON.stringify({jsonrpc:'2.0', ...message}));
            const response = async id => {
                for (let i = 0; i < 150; i++) {
                    const value = messages.find(message => message.id === id);
                    if (value) {
                        if (value.error) throw new Error(JSON.stringify(value.error));
                        return value.result;
                    }
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
                throw new Error('No LSP response for ' + id);
            };
            try {
                await handle.ready;
                send({id:1, method:'initialize', params:{processId:null, rootUri:paths.rootUri, capabilities:{}, initializationOptions:{provideFormatter:true}}});
                const initialized = await response(1);
                if (!initialized.capabilities.documentFormattingProvider) throw new Error('Formatting unavailable');
                send({method:'initialized', params:{}});
                send({method:'textDocument/didOpen', params:{textDocument:{uri:paths.documentUri, languageId:'json', version:1, text:'{"hello":1}'}}});
                send({id:2, method:'textDocument/formatting', params:{textDocument:{uri:paths.documentUri}, options:{tabSize:2, insertSpaces:true}}});
                const edits = await response(2);
                if (!edits.length) throw new Error('JSON server returned no formatting edits');
                send({id:3, method:'shutdown', params:null});
                await response(3);
                send({method:'exit'});
                return {provider:provider.id, edits:edits.length};
            } finally {
                await handle.dispose();
                for (const process of await Executor.listProcesses()) {
                    if (process.command.includes('ios-json-test')) await Executor.stop(process.id);
                }
            }
            """#, arguments: [:], in: nil, contentWorld: .page) as? [String: Any]
        XCTAssertEqual(result?["provider"] as? String, "builtin-alpine")
        XCTAssertGreaterThan(result?["edits"] as? Int ?? 0, 0)
    }
}

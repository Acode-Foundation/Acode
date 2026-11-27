import XCTest
import WebKit
@testable import runner

@MainActor
final class WebShadowCaretTests: BridgeTestCase {
    func testHostAndPluginWebViewsInstallTheFallbackAtDocumentStart() async throws {
        let host = try await appWebView()
        let plugin = PluginWebView(options: ["mode": "hidden"])
        defer { plugin.destroy() }
        for view in [host, plugin.controller.webView] {
            let scripts = view.configuration.userContentController
            let installed = scripts.userScripts.filter { $0.source == WebShadowCaret.script }
            XCTAssertEqual(installed.count, 1)
            XCTAssertEqual(installed.first?.injectionTime, .atDocumentStart)
            XCTAssertEqual(installed.first?.isForMainFrameOnly, false)
            WebShadowCaret.install(on: scripts)
            XCTAssertEqual(scripts.userScripts.filter { $0.source == WebShadowCaret.script }.count, 1)
        }
    }

    func testFinalCharacterDeletionRepeatedBackspaceAndTypingInShadowEditors() async throws {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        WebShadowCaret.install(on: configuration.userContentController)
        let view = WKWebView(frame: CGRect(x: 0, y: 0, width: 400, height: 600), configuration: configuration)
        view.loadHTMLString("<meta name='viewport' content='width=device-width'><body><iframe srcdoc='<body></body>'></iframe></body>", baseURL: nil)
        for _ in 0..<100 {
            if !view.isLoading,
               (try? await view.evaluateJavaScript("document.querySelector('iframe')?.contentDocument?.readyState === 'complete'")) as? Bool == true { break }
            try await Task.sleep(for: .milliseconds(50))
        }
        let script = """
            (() => {
                for (const doc of [document, document.querySelector('iframe').contentDocument]) {
                    if (doc.defaultView.Selection.prototype.addRange.name !== 'acodeShadowCaretAddRange')
                        throw Error('Missing document-start fallback');
                    for (const mode of ['open', 'closed']) {
                        const host = doc.body.appendChild(doc.createElement('div'));
                        const shadow = host.attachShadow({mode});
                        const editor = shadow.appendChild(doc.createElement('div'));
                        editor.contentEditable = 'true';
                        editor.style.minHeight = '40px';
                        // Reproduce an unmodified plugin that clears blank markup and resets its caret.
                        const cleanup = () => {
                            if (editor.textContent.trim()) return;
                            editor.replaceChildren();
                            const range = doc.createRange();
                            range.setStart(editor, 0); range.collapse(true);
                            const selection = doc.getSelection();
                            selection.removeAllRanges(); selection.addRange(range);
                        };
                        editor.addEventListener('input', cleanup);
                        editor.focus();
                        doc.execCommand('insertText', false, 'x');
                        if (editor.textContent !== 'x') throw Error(mode + ': initial typing failed');
                        for (let n = 0; n < 3; n++) {
                            doc.execCommand('delete');
                            if (editor.textContent || shadow.activeElement !== editor || !doc.getSelection().rangeCount)
                                throw Error(mode + ': caret lost after deletion ' + n);
                        }
                        doc.execCommand('insertText', false, 'again');
                        if (editor.textContent !== 'again') throw Error(mode + ': typing again failed');
                        const chip = doc.createElement('span');
                        chip.contentEditable = 'false'; chip.dataset.chip = 'image'; chip.textContent = 'image';
                        editor.prepend(chip);
                        const caret = doc.createRange();
                        caret.setStart(editor, editor.childNodes.length); caret.collapse(true);
                        doc.getSelection().removeAllRanges(); doc.getSelection().addRange(caret);
                        doc.execCommand('insertText', false, '!');
                        if (!editor.contains(chip) || !editor.textContent.includes('again!'))
                            throw Error(mode + ': attachment changed');
                        const input = doc.body.appendChild(doc.createElement('input'));
                        input.value = 'other'; input.focus(); input.setSelectionRange(2, 2);
                        const range = doc.createRange(); range.setStart(editor, 0); range.collapse(true);
                        const selection = doc.getSelection(); selection.removeAllRanges();
                        const before = [input.selectionStart, input.selectionEnd];
                        selection.addRange(range);
                        if (doc.activeElement !== input || input.selectionStart !== before[0] || input.selectionEnd !== before[1])
                            throw Error(mode + ': background selection stole focus');
                        host.remove(); input.remove();
                    }
                }
                return true;
            })()
            """
        let result = try await view.evaluateJavaScript(script) as? Bool
        XCTAssertEqual(result, true)
    }
}

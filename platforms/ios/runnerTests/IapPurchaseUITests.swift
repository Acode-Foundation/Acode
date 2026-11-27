import StoreKitTest
import WebKit
import XCTest

@MainActor
final class IapPurchaseUITests: BridgeTestCase {
    private var session: SKTestSession!

    override func setUp() async throws {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "Iap", withExtension: "storekit"))
        session = try SKTestSession(contentsOf: url)
        session.resetToDefaultState()
        session.clearTransactions()
        session.disableDialogs = true
        try await super.setUp()
        try await reloadWebView(try await appWebView())
        _ = try await editorWebView()
    }

    override func tearDownWithError() throws {
        session?.clearTransactions()
        session?.resetToDefaultState()
        session = nil
    }

    func testSettingsPurchaseUnlocksProAndShowsFeedbackWithoutReload() async throws {
        let webView = try await editorWebView()
        _ = try await webView.evaluateJavaScript("localStorage.removeItem('acode_pro')")
        try await reloadWebView(webView)
        _ = try await editorWebView()
        let result = try await webView.callAsyncJavaScript("""
            await acode.exec('open','settings');
            const page=acode.require('settings').uiSettings['main-settings'];
            const row=page.getListElement().querySelector('[data-key="removeads"]');
            if(!row||row.hidden)throw Error('Remove ads not available before purchase');
            try {
                row.click();
                await Promise.resolve();
                const loading=!!document.querySelector('#__loader:not(.hide)');
                for(let n=0;n<200;n++) {
                    if(!row.isConnected&&!document.querySelector('#__loader:not(.hide)')) {
                        await new Promise(resolve=>setTimeout(resolve,4000));
                        const confirmation=document.querySelector('.prompt.alert:not(#__loader):not(.hide)');
                        const feedback=confirmation?.querySelector('.title')?.textContent===strings.success&&
                            confirmation?.querySelector('.message')?.textContent===strings['thank you :)'];
                        confirmation?.querySelector('button')?.click();
                        return {loading,feedback,pro:acode.require('config').HAS_PRO,cached:localStorage.getItem('acode_pro')};
                    }
                    await new Promise(resolve=>setTimeout(resolve,50));
                }
                throw Error('Purchase did not update Settings: '+JSON.stringify({pro:acode.require('config').HAS_PRO,dialogs:[...document.querySelectorAll('.prompt:not(.hide)')].map(el=>el.textContent)}));
            } finally {page.hide();localStorage.removeItem('acode_pro');}
            """, arguments: [:], in: nil, contentWorld: .page) as? [String: Any]
        XCTAssertEqual(result?["loading"] as? Bool, true)
        XCTAssertEqual(result?["feedback"] as? Bool, true)
        XCTAssertEqual(result?["pro"] as? Bool, true)
        XCTAssertEqual(result?["cached"] as? String, "true")
        try await reloadOffline(webView)
        let restored = try await webView.evaluateJavaScript("acode.require('config').HAS_PRO") as? Bool
        XCTAssertEqual(restored, true)
    }

    func testCancelledPurchaseAfterHistoryResetCannotRestoreStaleProWhenOffline() async throws {
        let webView = try await editorWebView()
        _ = try await webView.evaluateJavaScript("localStorage.setItem('acode_pro','true')")
        defer { webView.evaluateJavaScript("localStorage.removeItem('acode_pro')") }
        try await reloadWebView(webView)
        _ = try await editorWebView()
        try await session.setSimulatedError(.generic(.userCancelled), forAPI: StoreKitPurchaseAPI())
        let cancelled = try await webView.callAsyncJavaScript("""
            await acode.exec('open','settings');
            const page=acode.require('settings').uiSettings['main-settings'];
            const row=page.getListElement().querySelector('[data-key="removeads"]');
            if(!row||row.hidden)throw Error('Stale cache blocked purchasing after history reset');
            try {
                row.click();
                await Promise.resolve();
                for(let n=0;n<200;n++) {
                    if(!document.querySelector('#__loader:not(.hide)')) {
                        return !acode.require('config').HAS_PRO&&row.isConnected&&
                            !document.querySelector('.prompt.alert:not(#__loader):not(.hide)');
                    }
                    await new Promise(resolve=>setTimeout(resolve,50));
                }
                return false;
            } finally {page.hide();}
            """, arguments: [:], in: nil, contentWorld: .page) as? Bool
        XCTAssertEqual(cancelled, true)
        XCTAssertFalse(session.allTransactions().contains { $0.state == .purchased || $0.state == .restored })
        try await reloadOffline(webView)
        let state = try await webView.evaluateJavaScript("({pro:acode.require('config').HAS_PRO,cached:localStorage.getItem('acode_pro')==='true'})") as? [String: Bool]
        XCTAssertEqual(state?["pro"], false)
        XCTAssertEqual(state?["cached"], false)
    }

    func testVerificationFailureCannotRestoreStalePro() async throws {
        let webView = try await editorWebView()
        _ = try await session.buyProduct(identifier: "acode_pro_new")
        try await session.setSimulatedError(.verification(.invalidSignature), forAPI: StoreKitVerificationAPI())
        _ = try await webView.evaluateJavaScript("localStorage.setItem('acode_pro','true')")
        defer { webView.evaluateJavaScript("localStorage.removeItem('acode_pro')") }
        try await reloadOffline(webView)
        let restored = try await webView.evaluateJavaScript("acode.require('config').HAS_PRO") as? Bool
        XCTAssertEqual(restored, false)
    }

    private func reloadOffline(_ webView: WKWebView) async throws {
        let scripts = webView.configuration.userContentController
        // WebKit's bridged array changes when scripts are removed; materialize a snapshot.
        let originalScripts = scripts.userScripts.map { $0 }
        defer {
            scripts.removeAllUserScripts()
            originalScripts.forEach(scripts.addUserScript)
        }
        scripts.addUserScript(WKUserScript(source: "Object.defineProperty(navigator,'onLine',{get:()=>false})", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        try await reloadWebView(webView)
        _ = try await editorWebView()
    }
}

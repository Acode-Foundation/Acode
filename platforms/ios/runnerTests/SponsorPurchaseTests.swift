import StoreKitTest
import WebKit
import XCTest

@MainActor
final class SponsorPurchaseTests: BridgeTestCase {
    private var session: SKTestSession!
    private var scripts: WKUserContentController?
    private var originalScripts: [WKUserScript] = []

    override func setUp() async throws {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "Iap", withExtension: "storekit"))
        session = try SKTestSession(contentsOf: url)
        session.resetToDefaultState()
        session.clearTransactions()
        session.disableDialogs = true
        let webView = try await appWebView()
        let scripts = webView.configuration.userContentController
        self.scripts = scripts
        originalScripts = scripts.userScripts
        // The app protects fetch after startup, and the iOS transport rewrites API URLs.
        scripts.addUserScript(WKUserScript(source: """
            window.sponsorRequests=[];window.sponsorReject=true;window.sponsorFailureStatus=503;
            const originalFetch=window.fetch.bind(window);
            window.fetch=async(input,options)=>{
                const request=new Request(input,options);
                const path=new URL(request.url).pathname;
                if(['/api/sponsors','/__api__/sponsors'].includes(path))return new Response('[]');
                if(['/api/sponsor','/__api__/sponsor'].includes(path)) {
                    sponsorRequests.push(await request.json());
                    return new Response(JSON.stringify(sponsorReject?{error:'Test registration failure'}:{}),{status:sponsorReject?sponsorFailureStatus:201});
                }
                return originalFetch(input,options);
            };
            """, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        _ = try await webView.evaluateJavaScript("localStorage.removeItem('sponsor_pending_app.acode');localStorage.removeItem('sponsor_crystal')")
        try await super.setUp()
        try await reloadWebView(webView)
        _ = try await editorWebView()
    }

    override func tearDownWithError() throws {
        scripts?.removeAllUserScripts()
        for script in originalScripts { scripts?.addUserScript(script) }
        scripts = nil
        originalScripts = []
        session?.clearTransactions()
        session?.resetToDefaultState()
        session = nil
    }

    func testSponsorPurchaseRetriesRegistrationBeforeFinishingAndCanBeBoughtAgain() async throws {
        let webView = try await prepare()
        try await openSponsor(webView)
        let count = try await webView.evaluateJavaScript("document.querySelectorAll('#sponsor-page .tier').length") as? Int
        XCTAssertEqual(count, 6)
        try await selectCrystal(webView)
        try await wait(webView, "sponsorRequests.length===1")
        let unfinished = try await purchases(webView)
        XCTAssertEqual(unfinished.count, 1)
        let request = try await webView.evaluateJavaScript("sponsorRequests[0]") as? [String: Any]
        XCTAssertEqual(request?["tier"] as? String, "crystal")
        XCTAssertEqual(request?["packageName"] as? String, "app.acode")
        XCTAssertEqual((request?["purchaseToken"] as? String)?.split(separator: ".").count, 3)
        let retained = try await webView.evaluateJavaScript("!!localStorage.getItem('sponsor_crystal')") as? Bool
        XCTAssertEqual(retained, true)
        // Reopening the page recovers the unfinished transaction after a network failure.
        _ = try await webView.evaluateJavaScript("sponsorReject=false;document.querySelectorAll('.prompt:not(.hide) button').forEach(button=>button.click());document.querySelector('#sponsor-page').closest('wc-page').hide()")
        try await openSponsor(webView, waitForProducts: false)
        try await wait(webView, "sponsorRequests.length===2&&!localStorage.getItem('sponsor_crystal')")
        let remaining = try await purchases(webView)
        XCTAssertTrue(remaining.isEmpty)
        _ = try await webView.evaluateJavaScript("document.querySelectorAll('.prompt:not(.hide) button').forEach(button=>button.click())")
        try await openSponsor(webView)
        try await selectCrystal(webView)
        try await wait(webView, "sponsorRequests.length===3&&!localStorage.getItem('sponsor_crystal')")
        XCTAssertEqual(session.allTransactions().filter { $0.productIdentifier == "crystal" }.count, 2)
        let finished = try await purchases(webView)
        XCTAssertTrue(finished.isEmpty)
    }

    func testCancelledAndPendingSponsorPurchasesDoNotRegisterUntilApproved() async throws {
        let webView = try await prepare()
        _ = try await webView.evaluateJavaScript("sponsorReject=false")
        try await openSponsor(webView)
        try await session.setSimulatedError(.generic(.userCancelled), forAPI: StoreKitPurchaseAPI())
        try await selectCrystal(webView)
        try await wait(webView, "sponsorErrors.includes(1)&&app.classList.contains('title-loading-hide')")
        let cancelledCount = try await webView.evaluateJavaScript("sponsorRequests.length") as? Int
        XCTAssertEqual(cancelledCount, 0)
        try await session.setSimulatedError(nil, forAPI: StoreKitPurchaseAPI())
        session.askToBuyEnabled = true
        try await selectCrystal(webView)
        for _ in 0..<100 {
            if session.allTransactions().contains(where: { $0.state == .deferred }) { break }
            try await Task.sleep(for: .milliseconds(100))
        }
        let pending = try XCTUnwrap(session.allTransactions().first { $0.state == .deferred })
        let pendingCount = try await webView.evaluateJavaScript("sponsorRequests.length") as? Int
        XCTAssertEqual(pendingCount, 0)
        try session.approveAskToBuyTransaction(identifier: pending.identifier)
        try await wait(webView, "sponsorRequests.length===1&&!localStorage.getItem('sponsor_crystal')")
    }

    func testPaidSponsorRecoversAfterReloadWithoutOpeningSponsorPage() async throws {
        let webView = try await prepare()
        // Keep fulfillment pending, then lose the WebView and its local purchase context.
        _ = try await session.buyProduct(identifier: "crystal")
        _ = try await webView.evaluateJavaScript("localStorage.removeItem('sponsor_crystal');localStorage.removeItem('sponsor_pending_app.acode')")
        let scripts = webView.configuration.userContentController
        let originalScripts = scripts.userScripts.map { $0 }
        defer {
            scripts.removeAllUserScripts()
            originalScripts.forEach(scripts.addUserScript)
        }
        scripts.addUserScript(WKUserScript(source: """
            window.sponsorReject=false;
            """, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        try await reloadWebView(webView)
        _ = try await editorWebView()
        try await wait(webView, "!!document.querySelector('.prompt.multi:not(.hide) input')")
        let page = try await webView.evaluateJavaScript("!!document.querySelector('#sponsor-page')") as? Bool
        XCTAssertEqual(page, false)
        _ = try await webView.evaluateJavaScript("document.querySelector('.prompt.multi:not(.hide) .help').click()")
        let message = try await webView.evaluateJavaScript("document.querySelector('.prompt.alert:not(.hide)').textContent") as? String
        XCTAssertTrue(message?.contains("not be charged again") == true)
        _ = try await webView.evaluateJavaScript("""
            document.querySelector('.prompt.alert:not(.hide) button').click();
            const input=document.querySelector('.prompt.multi:not(.hide) input');
            input.value='Recovered Sponsor';input.dispatchEvent(new Event('input',{bubbles:true}));
            document.querySelector('.prompt.multi:not(.hide) button[type="submit"]').click();
            """)
        try await wait(webView, "sponsorRequests.length===1&&!localStorage.getItem('sponsor_pending_app.acode')")
        let request = try await webView.evaluateJavaScript("sponsorRequests[0]") as? [String: Any]
        XCTAssertEqual(request?["name"] as? String, "Recovered Sponsor")
        XCTAssertEqual(request?["tier"] as? String, "crystal")
        XCTAssertEqual(session.allTransactions().filter { $0.productIdentifier == "crystal" }.count, 1)
        let remaining = try await purchases(webView)
        XCTAssertTrue(remaining.isEmpty)
    }

    func testRejectedDetailsCanBeCorrectedWithoutAnotherCharge() async throws {
        let webView = try await prepare()
        _ = try await webView.evaluateJavaScript("sponsorFailureStatus=400")
        try await openSponsor(webView)
        try await selectCrystal(webView)
        try await wait(webView, "sponsorRequests.length===1&&!localStorage.getItem('sponsor_crystal')")
        let unfinished = try await purchases(webView)
        XCTAssertEqual(unfinished.count, 1)
        let details = try await webView.evaluateJavaScript("JSON.parse(localStorage.getItem('sponsor_pending_app.acode'))[0].details===null") as? Bool
        XCTAssertEqual(details, true)
        _ = try await webView.evaluateJavaScript("sponsorReject=false;document.querySelectorAll('.prompt:not(.hide) button').forEach(button=>button.click());document.querySelector('#sponsor-page').closest('wc-page').hide()")
        try await openSponsor(webView)
        try await wait(webView, "!!document.querySelector('.prompt.multi:not(.hide) input')")
        _ = try await webView.evaluateJavaScript("""
            const input=document.querySelector('.prompt.multi:not(.hide) input');
            input.value='Corrected Sponsor';input.dispatchEvent(new Event('input',{bubbles:true}));
            document.querySelector('.prompt.multi:not(.hide) button[type="submit"]').click();
            """)
        try await wait(webView, "sponsorRequests.length===2&&!localStorage.getItem('sponsor_pending_app.acode')")
        let name = try await webView.evaluateJavaScript("sponsorRequests[1].name") as? String
        XCTAssertEqual(name, "Corrected Sponsor")
        XCTAssertEqual(session.allTransactions().filter { $0.productIdentifier == "crystal" }.count, 1)
        let remaining = try await purchases(webView)
        XCTAssertTrue(remaining.isEmpty)
    }

    private func prepare() async throws -> WKWebView {
        let webView = try await editorWebView()
        _ = try await webView.evaluateJavaScript("""
            window.sponsorRequests=[];window.sponsorErrors=[];window.sponsorReject=true;window.sponsorFailureStatus=503;
            const originalPurchase=iap.purchase;
            iap.purchase=(product,success,failure,updateError)=>originalPurchase(product,success,
                error=>{sponsorErrors.push(error);failure?.(error)},
                updateError?error=>{sponsorErrors.push(error);updateError(error)}:undefined);
            localStorage.removeItem('sponsor_crystal');
            null;
            """)
        _ = try await webView.callAsyncJavaScript("""
            await acode.exec('open','settings');
            acode.require('settings').uiSettings['main-settings'].getListElement().querySelector('[data-key="sponsors"]').click();
            """, arguments: [:], in: nil, contentWorld: .page)
        try await wait(webView, "!!document.querySelector('#sponsors-page .cta-button')")
        return webView
    }

    private func openSponsor(_ webView: WKWebView, waitForProducts: Bool = true) async throws {
        // A closing page remains in the DOM until its fade-out finishes.
        try await wait(webView, "!document.querySelector('#sponsor-page')&&!!document.querySelector('#sponsors-page .cta-button')")
        _ = try await webView.evaluateJavaScript("document.querySelector('#sponsors-page .cta-button').click()")
        if waitForProducts { try await wait(webView, "!!document.querySelector('#sponsor-page .crystal .purchase-btn')") }
    }

    private func selectCrystal(_ webView: WKWebView) async throws {
        _ = try await webView.evaluateJavaScript("document.querySelector('#sponsor-page .crystal .purchase-btn').click()")
        try await wait(webView, "!!document.querySelector('.prompt.multi:not(.hide) input')")
        _ = try await webView.callAsyncJavaScript("""
            const input=document.querySelector('.prompt.multi:not(.hide) input');input.value='Simulator Sponsor';input.dispatchEvent(new Event('input',{bubbles:true}));
            document.querySelector('.prompt.multi:not(.hide) button[type="submit"]').click();
            """, arguments: [:], in: nil, contentWorld: .page)
    }

    private func purchases(_ webView: WKWebView) async throws -> [[String: Any]] {
        try await webView.callAsyncJavaScript("return await new Promise((resolve,reject)=>iap.getPurchases(resolve,reject))", arguments: [:], in: nil, contentWorld: .page) as? [[String: Any]] ?? []
    }

    private func wait(_ webView: WKWebView, _ expression: String) async throws {
        for _ in 0..<150 {
            if try await webView.evaluateJavaScript(expression) as? Bool == true { return }
            try await Task.sleep(for: .milliseconds(100))
        }
        let details = try await webView.evaluateJavaScript("JSON.stringify({errors:window.sponsorErrors,requests:window.sponsorRequests?.map(({purchaseToken,...details})=>details),details:localStorage.getItem('sponsor_crystal'),dialogs:[...document.querySelectorAll('.prompt:not(.hide)')].map(element=>element.textContent)})")
        throw NSError(domain: "SponsorTests", code: 1, userInfo: [NSLocalizedDescriptionKey: "Timed out: \(expression); scene=\(String(describing: webView.window?.windowScene?.activationState)); \(details ?? "")"])
    }
}

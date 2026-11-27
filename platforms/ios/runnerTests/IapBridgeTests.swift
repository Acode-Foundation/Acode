import XCTest
import StoreKit
import StoreKitTest
import WebKit
@testable import runner

@MainActor
final class IapBridgeTests: BridgeTestCase {
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

    func testProductsPurchaseAcknowledgementRestoreAndRevocation() async throws {
        let webView = try await prepare()
        let products = try await call(webView, action: "getProducts", args: [["acode_pro_new", "ios_test_tip", "missing"]]) as? [[String: Any]]
        let pro = try XCTUnwrap(products?.first { $0["productId"] as? String == "acode_pro_new" })
        XCTAssertEqual(products?.count, 2)
        XCTAssertEqual(pro["title"] as? String, "Acode Pro test")
        XCTAssertEqual(pro["priceAmountMicros"] as? Int, 4_990_000)
        XCTAssertEqual(pro["priceCurrencyCode"] as? String, "USD")
        let purchase = try await buy(webView, product: "acode_pro_new")
        XCTAssertEqual(purchase["purchaseState"] as? Int, 1)
        XCTAssertEqual(purchase["isAcknowledged"] as? Bool, false)
        XCTAssertEqual(purchase["store"] as? String, "appstore")
        let token = try XCTUnwrap(purchase["purchaseToken"] as? String)
        XCTAssertEqual(token.split(separator: ".").count, 3)
        XCTAssertEqual(purchase["signedTransactionInfo"] as? String, token)
        _ = try await call(webView, action: "acknowledgePurchase", args: [token])
        let restored = try await call(webView, action: "restorePurchases") as? [[String: Any]]
        XCTAssertEqual(restored?.count, 1)
        XCTAssertEqual(restored?.first?["isAcknowledged"] as? Bool, true)
        let settingsRestored = try await webView.callAsyncJavaScript("""
            await acode.exec('open','settings');
            const page=acode.require('settings').uiSettings['main-settings'];
            const saved=localStorage.getItem('acode_pro');
            try {
                page.getListElement().querySelector('[data-key="restorePurchases"]').click();
                for(let n=0;n<100;n++) {
                    const toast=document.querySelector('#toast .message');
                    if(toast?.textContent===(strings['purchases restored']||'Purchases restored')) {
                        const removeAds=page.getListElement().querySelector('[data-key="removeads"]');
                        return localStorage.getItem('acode_pro')==='true'&&(!removeAds||removeAds.hidden);
                    }
                    await new Promise(resolve=>setTimeout(resolve,50));
                }
                throw Error('Restore UI did not finish: '+JSON.stringify({toast:document.querySelector('#toast .message')?.textContent,dialogs:[...document.querySelectorAll('.prompt:not(.hide)')].map(el=>el.textContent),cached:localStorage.getItem('acode_pro')}));
            } finally {page.hide();if(saved===null)localStorage.removeItem('acode_pro');else localStorage.setItem('acode_pro',saved);}
            """, arguments: [:], in: nil, contentWorld: .page) as? Bool
        XCTAssertEqual(settingsRestored, true)
        let owned = try await error(webView, action: "purchase", args: ["acode_pro_new"])
        XCTAssertEqual(owned, 7)
        let badToken = try await error(webView, action: "acknowledgePurchase", args: ["forged"])
        XCTAssertEqual(badToken, 8)
        let notConsumable = try await error(webView, action: "consume", args: [token])
        XCTAssertEqual(notConsumable, 5)
        let transaction = try XCTUnwrap(session.allTransactions().first)
        try session.refundTransaction(identifier: transaction.identifier)
        for _ in 0..<50 {
            if (try await call(webView, action: "getPurchases") as? [Any])?.isEmpty == true { return }
            try await Task.sleep(for: .milliseconds(100))
        }
        XCTFail("Refunded entitlement remained owned")
    }

    func testUnfinishedPurchasesSurviveReloadAndConsumablesCanBeBoughtAgain() async throws {
        let webView = try await prepare()
        let first = try await buy(webView, product: "ios_test_tip")
        try await reloadWebView(webView)
        _ = try await prepare()
        let purchases = try await call(webView, action: "getPurchases") as? [[String: Any]]
        XCTAssertEqual(purchases?.count, 1)
        XCTAssertEqual(purchases?.first?["isAcknowledged"] as? Bool, false)
        let token = try XCTUnwrap(purchases?.first?["purchaseToken"] as? String)
        let consumed = try await call(webView, action: "consume", args: [token]) as? Int
        XCTAssertEqual(consumed, 0)
        let remaining = try await call(webView, action: "getPurchases") as? [Any]
        XCTAssertEqual(remaining?.count, 0)
        let repeatConsume = try await error(webView, action: "consume", args: [token])
        XCTAssertEqual(repeatConsume, 8)
        let second = try await buy(webView, product: "ios_test_tip")
        XCTAssertNotEqual(first["transactionId"] as? String, second["transactionId"] as? String)
        _ = try await call(webView, action: "consume", args: [try XCTUnwrap(second["purchaseToken"] as? String)])
    }

    func testCancellationKeepsListenerAndPendingApprovalDeliversOnlyOnce() async throws {
        let webView = try await prepare()
        try await session.setSimulatedError(.generic(.userCancelled), forAPI: StoreKitPurchaseAPI())
        _ = try await call(webView, action: "purchase", args: ["ios_test_plugin"])
        let cancelled = try await wait(webView, expression: "window.iapTestErrors[0]===1")
        XCTAssertTrue(cancelled)
        try await session.setSimulatedError(nil, forAPI: StoreKitPurchaseAPI())
        session.askToBuyEnabled = true
        _ = try await call(webView, action: "purchase", args: ["ios_test_plugin"])
        let pending = try await wait(webView, expression: "window.iapTestEvents.some(event=>event.purchaseState===2)")
        XCTAssertTrue(pending)
        let before = try await call(webView, action: "getPurchases") as? [Any]
        XCTAssertEqual(before?.count, 0)
        let transaction = try XCTUnwrap(session.allTransactions().first { $0.state == .deferred })
        try session.approveAskToBuyTransaction(identifier: transaction.identifier)
        let approved = try await wait(webView, expression: "window.iapTestEvents.filter(event=>event.purchaseState===1).length===1")
        XCTAssertTrue(approved)
        try await Task.sleep(for: .milliseconds(300))
        let count = try await webView.evaluateJavaScript("window.iapTestEvents.filter(event=>event.purchaseState===1).length") as? Int
        XCTAssertEqual(count, 1)
    }

    func testVerificationFailureNeverGrantsOrFinishesPurchase() async throws {
        let webView = try await prepare()
        try await session.setSimulatedError(.verification(.invalidSignature), forAPI: StoreKitVerificationAPI())
        _ = try await call(webView, action: "purchase", args: ["ios_test_plugin"])
        let failed = try await wait(webView, expression: "window.iapTestErrors.includes(6)")
        XCTAssertTrue(failed)
        let count = try await webView.evaluateJavaScript("window.iapTestEvents.length") as? Int
        XCTAssertEqual(count, 0)
        let queryError = try await error(webView, action: "getPurchases")
        XCTAssertEqual(queryError, 6)
        var unfinished = 0
        for await result in Transaction.unfinished {
            unfinished += 1
            guard case .unverified = result else { XCTFail("Expected invalid StoreKit signature"); continue }
            let finishError = try await error(webView, action: "acknowledgePurchase", args: [result.jwsRepresentation])
            XCTAssertEqual(finishError, 6)
        }
        XCTAssertEqual(unfinished, 1)
    }

    private func prepare() async throws -> WKWebView {
        let webView = try await appWebView()
        _ = try await webView.callAsyncJavaScript("""
            await new Promise(resolve=>document.addEventListener('deviceready',resolve));
            window.iapTestEvents=[];window.iapTestErrors=[];
            iap.setPurchaseUpdatedListener(purchases=>iapTestEvents.push(...purchases),error=>iapTestErrors.push(error));
            await new Promise((resolve,reject)=>iap.startConnection(resolve,reject));
            """, arguments: [:], in: nil, contentWorld: .page)
        return webView
    }

    private func buy(_ webView: WKWebView, product: String) async throws -> [String: Any] {
        _ = try await webView.evaluateJavaScript("window.iapTestEvents=[];window.iapTestErrors=[]")
        _ = try await call(webView, action: "purchase", args: [product])
        let received = try await wait(webView, expression: "window.iapTestEvents.some(event=>event.purchaseState===1)||window.iapTestErrors.length>0")
        XCTAssertTrue(received)
        let events = try await webView.evaluateJavaScript("window.iapTestEvents") as? [[String: Any]]
        return try XCTUnwrap(events?.first { $0["purchaseState"] as? Int == 1 })
    }

    private func call(_ webView: WKWebView, action: String, args: [Any] = []) async throws -> Any? {
        try await webView.callAsyncJavaScript("try {return await new Promise((resolve,reject)=>iap[action](...args,resolve,reject));} catch(error) {throw new Error(action+': '+JSON.stringify(error));}", arguments: ["action": action, "args": args], in: nil, contentWorld: .page)
    }

    private func error(_ webView: WKWebView, action: String, args: [Any] = []) async throws -> Int? {
        try await webView.callAsyncJavaScript("try {await new Promise((resolve,reject)=>iap[action](...args,resolve,reject));return null;}catch(error){return error;}", arguments: ["action": action, "args": args], in: nil, contentWorld: .page) as? Int
    }

    private func wait(_ webView: WKWebView, expression: String) async throws -> Bool {
        for _ in 0..<100 {
            if try await webView.evaluateJavaScript(expression) as? Bool == true { return true }
            try await Task.sleep(for: .milliseconds(100))
        }
        return false
    }
}

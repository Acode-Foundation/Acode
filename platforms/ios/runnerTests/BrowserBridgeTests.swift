import SafariServices
import WebKit
import XCTest
@testable import runner

@MainActor
final class BrowserBridgeTests: BridgeTestCase {
    func testAcodeWebsiteLinksCarryIOSSourceWithoutLosingTheirDestination() throws {
        for host in ["acode.app", "dev.acode.app"] {
            for path in ["/", "/faqs", "/profile/edit"] {
                let original = try XCTUnwrap(URL(string: "https://\(host)\(path)?state=a%26b&src=android&src=ios#details"))
                let rewritten = SafariService.websiteURL(original)
                let components = try XCTUnwrap(URLComponents(url: rewritten, resolvingAgainstBaseURL: false))
                XCTAssertEqual(components.host, host)
                XCTAssertEqual(components.path, path)
                XCTAssertEqual(components.fragment, "details")
                XCTAssertEqual(components.queryItems?.filter { $0.name == "src" }, [URLQueryItem(name: "src", value: "ios")])
                XCTAssertEqual(components.queryItems?.first { $0.name == "state" }?.value, "a&b")
                XCTAssertEqual(SafariService.websiteURL(rewritten), rewritten)
            }
        }
        XCTAssertEqual(SafariService.websiteURL(URL(string: "https://acode.app")!).query, "src=ios")
        let encoded = "https://acode.app/login?code=a%2Bb&redirect=https%3A%2F%2Facode.app%2Fx%3Fkey%3Da%2Bb&flag&src=android#done"
        XCTAssertEqual(SafariService.websiteURL(URL(string: encoded)!).absoluteString,
                       encoded.replacingOccurrences(of: "src=android", with: "src=ios"))
    }

    func testOtherBrowserDestinationsRemainUnchanged() throws {
        for value in ["https://example.com/?src=android", "https://acode.app.example.com/", "https://docs.acode.app/",
                      "https://acode.app:8443/", "https://user@acode.app/", "http://acode.app/", "mailto:acode@foxdebug.com"] {
            let url = try XCTUnwrap(URL(string: value))
            XCTAssertEqual(SafariService.websiteURL(url), url)
        }
    }

    func testResetSettlesOpenCallbacksDuringPresentation() async throws {
        let webView = try await appWebView()
        var responder: UIResponder? = webView
        while responder != nil, !(responder is WebViewController) { responder = responder?.next }
        let controller = try XCTUnwrap(responder as? WebViewController)
        let replies = WKWebView()
        replies.loadHTMLString("<script>window.replies=[];window.iOS={callback:reply=>replies.push(reply)}</script>", baseURL: nil)
        for _ in 0..<100 {
            if (try? await replies.evaluateJavaScript("!!window.iOS")) as? Bool == true { break }
            try await Task.sleep(for: .milliseconds(20))
        }
        let service = SafariService(bridge: controller.bridge)
        defer { service.reset() }
        for (id, lifecycle) in [false, true].enumerated() {
            service.exec(action: "open", args: ["https://example.test", ["reportLifecycle": lifecycle]],
                         callback: Callback(id: id, webView: replies))
            for _ in 0..<100 {
                if controller.presentedViewController != nil { break }
                try await Task.sleep(for: .milliseconds(10))
            }
            XCTAssertNotNil(controller.presentedViewController)
            service.reset()
            for _ in 0..<100 {
                if controller.presentedViewController == nil,
                   (try? await replies.evaluateJavaScript("replies.length")) as? Int == id + 1 { break }
                try await Task.sleep(for: .milliseconds(20))
            }
        }
        let callbacks = try await replies.evaluateJavaScript("replies") as? [[String: Any]]
        XCTAssertEqual(callbacks?.compactMap { $0["status"] as? Int }, [9, 9])
        XCTAssertTrue(callbacks?.allSatisfy { $0["keep"] as? Bool == false } == true)
    }

    func testCustomTabsPresentSafariAndRejectInvalidSchemes() async throws {
        let webView = try await appWebView()
        let invalid = try await webView.callAsyncJavaScript("""
            for(const url of ['javascript:alert(1)', 'file:///etc/passwd', 'not a URL']) {
                let rejected=false;
                try { await new Promise((resolve,reject)=>CustomTabs.open(url,{},resolve,reject)); }
                catch { rejected=true; }
                if(!rejected) return false;
            }
            return true;
            """, arguments: [:], in: nil, contentWorld: .page) as? Bool
        XCTAssertEqual(invalid, true)
        var responder: UIResponder? = webView
        while responder != nil, !(responder is WebViewController) { responder = responder?.next }
        let controller = try XCTUnwrap(responder as? WebViewController)
        XCTAssertNil(controller.presentedViewController, "Presentation already active: \(String(describing: controller.presentedViewController))")
        let fixture = try HTTPFixture()
        try await fixture.start()
        defer { fixture.stop() }
        _ = try await webView.callAsyncJavaScript("window.browserEvents=[]; await new Promise((resolve,reject)=>CustomTabs.open(url,{toolbarColor:'#123456',reportLifecycle:true},event=>{browserEvents.push(event.type);resolve();},reject));", arguments: ["url": fixture.origin], in: nil, contentWorld: .page)
        let browser = try XCTUnwrap(controller.presentedViewController as? SFSafariViewController)
        if #unavailable(iOS 26) { XCTAssertEqual(browser.preferredBarTintColor, UIColor(hexString: "#123456")) }
        XCTAssertEqual(browser.dismissButtonStyle, .close)
        XCTAssertEqual(browser.modalPresentationStyle, .fullScreen)
        XCTAssertFalse(browser.configuration.barCollapsingEnabled)
        let redirected = try XCTUnwrap(URL(string: "https://example.test/sign-in?state=a%26b&code=c%2Bd#finish"))
        let activities = try XCTUnwrap(browser.delegate?.safariViewController?(browser, activityItemsFor: redirected, title: nil))
        let external = try XCTUnwrap(activities.first as? BrowserActivity)
        XCTAssertEqual(external.url, redirected)
        XCTAssertEqual(webView.url?.absoluteString, "acode://localhost/")
        browser.delegate?.safariViewControllerDidFinish?(browser)
        browser.delegate?.safariViewControllerDidFinish?(browser)
        await withCheckedContinuation { continuation in browser.dismiss(animated: false) { continuation.resume() } }
        let events = try await webView.callAsyncJavaScript("return window.browserEvents;", arguments: [:], in: nil, contentWorld: .page) as? [String]
        XCTAssertEqual(events, ["opened", "closed"])
        _ = try await webView.callAsyncJavaScript("await new Promise((resolve,reject)=>CustomTabs.open(url,{authTabId:'active-auth',reportLifecycle:true},resolve,reject));", arguments: ["url": fixture.origin], in: nil, contentWorld: .page)
        let reopened = try XCTUnwrap(controller.presentedViewController as? SFSafariViewController)
        _ = try await webView.callAsyncJavaScript("await new Promise((resolve,reject)=>cordova.exec(resolve,reject,'CustomTabs','close',['old-auth']));", arguments: [:], in: nil, contentWorld: .page)
        XCTAssertTrue(controller.presentedViewController === reopened)
        _ = try await webView.callAsyncJavaScript("await new Promise((resolve,reject)=>cordova.exec(resolve,reject,'CustomTabs','close',['active-auth']));", arguments: [:], in: nil, contentWorld: .page)
        XCTAssertNil(controller.presentedViewController)
        _ = try await webView.callAsyncJavaScript("await new Promise((resolve,reject)=>CustomTabs.open(url,{},resolve,reject)); await new Promise((resolve,reject)=>cordova.exec(resolve,reject,'CustomTabs','close',['active-auth']));", arguments: ["url": fixture.origin], in: nil, contentWorld: .page)
        let reading = try XCTUnwrap(controller.presentedViewController as? SFSafariViewController)
        await withCheckedContinuation { continuation in reading.dismiss(animated: false) { continuation.resume() } }
    }

    func testBrowserActionsPreserveSignInURLAndOnlyOfferInstalledBrowsers() throws {
        let url = try XCTUnwrap(URL(string: "https://example.test/path?q=a%26b&state=c%2Bd&redirect_uri=https%3A%2F%2Facode.app%2Fcallback#finish"))
        let available = BrowserActivity.available(for: url, canOpen: { _ in true })
        XCTAssertEqual(available.map(\.activityTitle), ["Open in Default Browser", "Open in Chrome", "Open in Firefox"])
        XCTAssertEqual(available[0].url, url)
        XCTAssertEqual(available[1].url.absoluteString, url.absoluteString.replacingOccurrences(of: "https://", with: "googlechromes://"))
        let firefox = try XCTUnwrap(URLComponents(url: available[2].url, resolvingAgainstBaseURL: false))
        XCTAssertEqual(firefox.queryItems?.first?.value, url.absoluteString)
        XCTAssertEqual(BrowserActivity.available(for: url, canOpen: { _ in false }).map(\.activityTitle), ["Open in Default Browser"])
        XCTAssertEqual(BrowserActivity.available(for: url, canOpen: { $0.scheme == "firefox" }).map(\.activityTitle), ["Open in Default Browser", "Open in Firefox"])
        let http = try XCTUnwrap(URL(string: "http://example.test/path"))
        XCTAssertEqual(BrowserActivity.available(for: http, canOpen: { _ in true })[1].url.scheme, "googlechrome")
        XCTAssertTrue(BrowserActivity.available(for: URL(string: "javascript:alert(1)")!, canOpen: { _ in true }).isEmpty)
        let declared = Bundle.main.object(forInfoDictionaryKey: "LSApplicationQueriesSchemes") as? [String]
        XCTAssertTrue(["googlechrome", "googlechromes", "firefox"].allSatisfy { declared?.contains($0) == true })
    }
}

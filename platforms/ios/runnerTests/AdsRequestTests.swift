import GoogleMobileAds
import UserMessagingPlatform
import WebKit
import XCTest
@testable import runner

@MainActor
final class AdsRequestTests: XCTestCase {
    func testAgeTreatmentPreservesRestrictionsAcrossPartialConfigurationUpdates() {
        let bridge = Bridge()
        let plugin = AMBPlugin(bridge: bridge)
        let configuration = MobileAds.shared.requestConfiguration
        let original = configuration.ageRestrictedTreatment
        defer { configuration.ageRestrictedTreatment = original }
        configure(["tagForChildDirectedTreatment": false, "tagForUnderAgeOfConsent": false])
        XCTAssertEqual(configuration.ageRestrictedTreatment, .unspecified)
        configure(["tagForUnderAgeOfConsent": true])
        XCTAssertEqual(configuration.ageRestrictedTreatment, .child)
        configure(["tagForChildDirectedTreatment": false])
        XCTAssertEqual(configuration.ageRestrictedTreatment, .child)
        configure(["tagForChildDirectedTreatment": true, "tagForUnderAgeOfConsent": false])
        XCTAssertEqual(configuration.ageRestrictedTreatment, .child)
        configure([:])
        XCTAssertEqual(configuration.ageRestrictedTreatment, .child)
        configure(["tagForChildDirectedTreatment": false])
        XCTAssertEqual(configuration.ageRestrictedTreatment, .unspecified)

        func configure(_ options: [String: Any]) {
            AMBContext(plugin, [options], Callback(id: 0, webView: nil)).configure()
        }
    }

    func testLoadAndShowRequireStartupEvenWithConsent() async throws {
        let bridge = Bridge()
        let plugin = AMBPlugin(bridge: bridge)
        let information = RequestConsentFixture()
        plugin.privacy = AMBPrivacy(plugin: plugin, information: information)
        let receiver = RequestReplyReceiver(loaded: expectation(description: "Callback page loaded"))
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.add(receiver, name: "reply")
        let replies = WKWebView(frame: .zero, configuration: configuration)
        replies.navigationDelegate = receiver
        defer { configuration.userContentController.removeScriptMessageHandler(forName: "reply") }
        replies.loadHTMLString("<script>window.iOS={callback:r=>webkit.messageHandlers.reply.postMessage(r)};</script>", baseURL: nil)
        await fulfillment(of: [receiver.loaded], timeout: 5)
        let ctx = AMBContext(plugin, [["id": "gate", "adUnitId": "fixture"]], Callback(id: 0, webView: nil))
        let ad = try XCTUnwrap(RequestAdFixture(ctx))
        plugin.ads[ad.id] = ad
        for allowed in [false, true] {
            information.allowed = allowed
            for action in ["adLoad", "adShow"] {
                let response = expectation(description: "\(action) rejected before startup")
                receiver.onReply = { payload in
                    XCTAssertEqual(payload["status"] as? Int, 9)
                    XCTAssertEqual(payload["error"] as? String, allowed
                        ? "Initialize ads before requesting ads" : "Gather ad consent before requesting ads")
                    response.fulfill()
                }
                plugin.exec(action: action, args: [["id": ad.id]], callback: Callback(id: 1, webView: replies))
                await fulfillment(of: [response], timeout: 5)
            }
        }
        XCTAssertEqual(ad.requests, 0)
        XCTAssertFalse(ad.recoverPresentation())
    }
}

private final class RequestConsentFixture: ConsentInformation {
    var allowed = false
    override var canRequestAds: Bool { allowed }
}

private final class RequestAdFixture: AMBFullScreen {
    var requests = 0
    override func isLoaded() -> Bool { true }
    override func load(_ ctx: AMBContext) { requests += 1; ctx.resolve() }
    override func show(_ ctx: AMBContext) { requests += 1; ctx.resolve(true) }
}

@MainActor
private final class RequestReplyReceiver: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
    let loaded: XCTestExpectation
    var onReply: ([String: Any]) -> Void = { _ in }

    init(loaded: XCTestExpectation) { self.loaded = loaded }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { loaded.fulfill() }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let payload = message.body as? [String: Any] else { XCTFail("Invalid callback payload"); return }
        onReply(payload)
    }
}

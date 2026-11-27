import XCTest
import WebKit
@testable import runner

@MainActor
final class AdsEditionTests: BridgeTestCase {
    func testIOSIsFreeWithAdvertisingAndCanonicalBundleId() async throws {
        XCTAssertEqual(Bundle.main.bundleIdentifier, "app.acode")
        let webView = try await appWebView()
        let included = try await webView.evaluateJavaScript("typeof window.admob !== 'undefined'") as? Bool
        let flavor = try await webView.evaluateJavaScript("BuildInfo.flavor") as? String
        XCTAssertEqual(included, true)
        XCTAssertEqual(flavor, "free")
        XCTAssertNotNil(NSClassFromString("GADMobileAds"))
        XCTAssertNotNil(NSClassFromString("UMPConsentInformation"))
        XCTAssertTrue((Bundle.main.object(forInfoDictionaryKey: "GADApplicationIdentifier") as? String)?.hasPrefix("ca-app-pub-") == true)
        XCTAssertNotNil(Bundle.main.url(forResource: "AMNAdView", withExtension: "nib"))
    }
}

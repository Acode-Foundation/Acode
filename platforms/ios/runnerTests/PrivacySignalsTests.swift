import UserMessagingPlatform
import XCTest
@testable import runner

extension AdsBridgeTests {
    func testPrivacyBridgeReturnsOnlyCurrentIabSignals() async throws {
        let (controller, plugin) = try await host()
        let suite = "acode.privacy-test.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        let original = plugin.privacy
        defer { plugin.privacy = original; defaults.removePersistentDomain(forName: suite) }
        let expected: [String: Any] = [
            "IABTCF_gdprApplies": 1, "IABTCF_TCString": "test-tc",
            "IABTCF_AddtlConsent": "2~1.2", "IABGPP_HDR_GppString": "test-gpp",
            "IABGPP_GppSID": "7_8", "IABTCF_PurposeConsents": "11000010000",
            "IABTCF_PurposeLegitimateInterests": "01000010000"
        ]
        for (key, value) in expected { defaults.set(value, forKey: key) }
        defaults.set("private", forKey: "unrelated-setting")
        plugin.privacy = AMBPrivacy(plugin: plugin, information: PrivacySignalsFixture(), defaults: defaults)
        let state = try await controller.webView.callAsyncJavaScript(
            "return await admob.privacy.getState();", arguments: [:], in: nil, contentWorld: .page) as? [String: Any]
        XCTAssertEqual(state?["consentStatus"] as? String, "obtained")
        XCTAssertEqual(state?["canRequestAds"] as? Bool, true)
        XCTAssertEqual(state?["iabSignals"] as? NSDictionary, expected as NSDictionary)
    }

    func testPrivacySnapshotReflectsWithdrawalAndRemovedSignals() async throws {
        let (controller, plugin) = try await host()
        let suite = "acode.privacy-test.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        let original = plugin.privacy
        defer { plugin.privacy = original; defaults.removePersistentDomain(forName: suite) }
        plugin.privacy = AMBPrivacy(plugin: plugin, information: PrivacySignalsFixture(), defaults: defaults)
        defaults.set(1, forKey: "IABTCF_gdprApplies")
        defaults.set("accepted-tc", forKey: "IABTCF_TCString")
        defaults.set("11000010000", forKey: "IABTCF_PurposeConsents")
        for purposes in ["11000010000", "00000000000", "11000010000"] {
            defaults.set(purposes, forKey: "IABTCF_PurposeConsents")
            let state = try await controller.webView.callAsyncJavaScript(
                "return await admob.privacy.getState();", arguments: [:], in: nil, contentWorld: .page) as? [String: Any]
            XCTAssertEqual(state?["canRequestAds"] as? Bool, true)
            let signals = try XCTUnwrap(state?["iabSignals"] as? [String: Any])
            XCTAssertEqual(signals["IABTCF_PurposeConsents"] as? String, purposes)
        }
        defaults.removeObject(forKey: "IABTCF_TCString")
        defaults.removeObject(forKey: "IABTCF_PurposeConsents")
        let state = try await controller.webView.callAsyncJavaScript(
            "return await admob.privacy.showOptions();", arguments: [:], in: nil, contentWorld: .page) as? [String: Any]
        let signals = try XCTUnwrap(state?["iabSignals"] as? [String: Any])
        XCTAssertNil(signals["IABTCF_TCString"])
        XCTAssertEqual(signals["IABTCF_PurposeConsents"] as? String, "")
    }

    func testPrivacySnapshotPreservesBitStringsAndMarksInvalidPurposeUnknown() throws {
        let suite = "acode.privacy-test.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let plugin = AMBPlugin(bridge: Bridge())
        let privacy = AMBPrivacy(plugin: plugin, information: PrivacySignalsFixture(), defaults: defaults)
        defaults.set("0", forKey: "IABTCF_gdprApplies")
        defaults.set("01000010000", forKey: "IABTCF_PurposeLegitimateInterests")
        defaults.set(1100001, forKey: "IABTCF_PurposeConsents")
        let signals = try XCTUnwrap(privacy.state["iabSignals"] as? [String: Any])
        XCTAssertEqual(signals["IABTCF_gdprApplies"] as? String, "0")
        XCTAssertEqual(signals["IABTCF_PurposeLegitimateInterests"] as? String, "01000010000")
        XCTAssertEqual(signals["IABTCF_PurposeConsents"] as? String, "")
    }
}

private final class PrivacySignalsFixture: ConsentInformation {
    override var consentStatus: ConsentStatus { .obtained }
    override var canRequestAds: Bool { true }
    override var privacyOptionsRequirementStatus: PrivacyOptionsRequirementStatus { .notRequired }
}

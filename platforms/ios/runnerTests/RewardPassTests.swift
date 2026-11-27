import XCTest
@testable import runner

final class RewardPassTests: XCTestCase {
    private let store = SecretStore(namespace: "ios-test.rewards." + UUID().uuidString)

    override func tearDownWithError() throws { try store.clear() }

    func testExistingPassPersistsAndExpiryNoticeIsConsumedOnce() throws {
        var date = Date()
        let expiry = Int64(date.timeIntervalSince1970 * 1000) + 3_600_000
        try store.set("reward_state", value: "{\"adFreeUntil\":\(expiry),\"redemptionsToday\":2}")
        let rewards = RewardPassManager(store: store, now: { date })
        let active = try status(rewards.getRewardStatus())
        XCTAssertEqual(active["isActive"] as? Bool, true)
        XCTAssertEqual(active["remainingMs"] as? Int64, 3_600_000)
        XCTAssertEqual(active["canRedeem"] as? Bool, false)
        XCTAssertEqual(active["hasPendingExpiryNotice"] as? Bool, false)
        let reopened = RewardPassManager(store: store, now: { date })
        XCTAssertEqual(try status(reopened.getRewardStatus())["adFreeUntil"] as? Int64, expiry)

        date = date.addingTimeInterval(3600)
        let expired = try status(reopened.getRewardStatus())
        XCTAssertEqual(expired["isActive"] as? Bool, false)
        XCTAssertEqual(expired["adFreeUntil"] as? Int64, 0)
        XCTAssertEqual(expired["remainingMs"] as? Int64, 0)
        XCTAssertEqual(expired["hasPendingExpiryNotice"] as? Bool, true)
        XCTAssertEqual(expired["expiryNoticePendingUntil"] as? Int64, expiry)
        let consumed = try status(rewards.getRewardStatus())
        XCTAssertEqual(consumed["hasPendingExpiryNotice"] as? Bool, false)
        XCTAssertEqual(consumed["lastExpiredRewardUntil"] as? Int64, expiry)
    }

    func testMissingOrMalformedStateCannotGrantTime() throws {
        let rewards = RewardPassManager(store: store)
        for raw in ["", "malformed", "{\"redemptionsToday\":2}"] {
            try store.set("reward_state", value: raw)
            let empty = try status(rewards.getRewardStatus())
            XCTAssertEqual(empty["isActive"] as? Bool, false)
            XCTAssertEqual(empty["canRedeem"] as? Bool, false)
            XCTAssertEqual(empty["hasPendingExpiryNotice"] as? Bool, false)
        }
    }

    func testUnchangedStatusDoesNotRewriteStorageAndDayRolloverIsPersisted() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .current
        var date = try XCTUnwrap(calendar.date(from: DateComponents(year: 2026, month: 11, day: 15, hour: 12)))
        let raw = """
        { "adFreeUntil": 0, "lastExpiredRewardUntil": 0, "expiryNoticePendingUntil": 0,
          "redemptionDay": "2026-11-15", "redemptionsToday": 2 }
        """
        try store.set("reward_state", value: raw)
        let rewards = RewardPassManager(store: store, now: { date })
        _ = try rewards.getRewardStatus()
        XCTAssertEqual(try store.get("reward_state"), raw, "An unchanged read must not rewrite even the JSON formatting")
        date = try XCTUnwrap(calendar.date(byAdding: .day, value: 1, to: date))
        XCTAssertEqual(try status(rewards.getRewardStatus())["redemptionsToday"] as? Int, 0)
        let saved = try status(store.get("reward_state"))
        XCTAssertEqual(saved["redemptionDay"] as? String, "2026-11-16")
    }

    private func status(_ value: String) throws -> [String: Any] {
        try XCTUnwrap(JSONSerialization.jsonObject(with: Data(value.utf8)) as? [String: Any])
    }
}

@MainActor
final class RewardBridgeTests: BridgeTestCase {
    func testStatusRemainsAvailableButRedemptionIsUnsupported() async throws {
        let webView = try await appWebView()
        let result = try await webView.callAsyncJavaScript("""
            const raw=await new Promise((resolve,reject)=>system.getRewardStatus(resolve,reject));
            if(typeof raw!=='string')throw Error('Changed reward response type');
            const status=JSON.parse(raw);
            if(status.canRedeem!==false)throw Error('New passes must remain disabled');
            if(typeof status.hasPendingExpiryNotice!=='boolean')throw Error('Missing expiry policy');
            if(typeof system.redeemReward!=='undefined')throw Error('Retired wrapper still exposed');
            try{await new Promise((resolve,reject)=>Bridge.exec(resolve,reject,'System','redeemReward',['quick']));return false;}
            catch(error){return error?.code==='UNSUPPORTED_ACTION';}
            """, arguments: [:], in: nil, contentWorld: .page) as? Bool
        XCTAssertEqual(result, true)
    }
}

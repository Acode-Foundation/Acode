import Foundation

// Preserves earned passes from before new redemptions were discontinued.
final class RewardPassManager {
    private static let hour: Int64 = 60 * 60 * 1000
    private static let maximumDuration = 10 * hour
    private static let maximumRedemptions = 3
    private let store: SecretStore
    private let now: () -> Date

    init(store: SecretStore = SecretStore(namespace: "ads"), now: @escaping () -> Date = Date.init) {
        self.store = store
        self.now = now
    }

    func getRewardStatus() throws -> String {
        let date = now()
        let raw = try store.get("reward_state")
        let values = (try? JSONSerialization.jsonObject(with: Data(raw.utf8))) as? [String: Any] ?? [:]
        var state = synchronizedState(values, date: date)
        let status = status(state, date: date)
        state.expiryNoticePendingUntil = 0
        try save(state, previous: values)
        return try json(status)
    }

    private func synchronizedState(_ values: [String: Any], date: Date) -> RewardPassState {
        let today = day(date)
        var state = RewardPassState(values, today: today)
        if state.redemptionDay != today {
            state.redemptionDay = today
            state.redemptionsToday = 0
        }
        if state.adFreeUntil > 0, state.adFreeUntil <= milliseconds(date) {
            state.expiryNoticePendingUntil = state.adFreeUntil
            state.lastExpiredRewardUntil = state.adFreeUntil
            state.adFreeUntil = 0
        }
        return state
    }

    private func status(_ state: RewardPassState, date: Date) -> [String: Any] {
        let time = milliseconds(date)
        return ["adFreeUntil": state.adFreeUntil, "lastExpiredRewardUntil": state.lastExpiredRewardUntil,
                "isActive": state.adFreeUntil > time, "remainingMs": max(0, state.adFreeUntil - time),
                "redemptionsToday": state.redemptionsToday,
                "remainingRedemptions": max(0, Self.maximumRedemptions - state.redemptionsToday),
                "maxRedemptionsPerDay": Self.maximumRedemptions, "maxActivePassMs": Self.maximumDuration,
                "hasPendingExpiryNotice": state.expiryNoticePendingUntil > 0,
                "expiryNoticePendingUntil": state.expiryNoticePendingUntil,
                "canRedeem": false, "redeemDisabledReason": "Ad-free passes are no longer available."]
    }

    private func save(_ state: RewardPassState, previous: [String: Any]) throws {
        let values: [String: Any] = [
            "adFreeUntil": state.adFreeUntil, "lastExpiredRewardUntil": state.lastExpiredRewardUntil,
            "expiryNoticePendingUntil": state.expiryNoticePendingUntil,
            "redemptionDay": state.redemptionDay, "redemptionsToday": state.redemptionsToday,
        ]
        if !NSDictionary(dictionary: values).isEqual(to: previous) {
            try store.set("reward_state", value: json(values))
        }
    }

    private func json(_ value: [String: Any]) throws -> String {
        String(decoding: try JSONSerialization.data(withJSONObject: value), as: UTF8.self)
    }

    private func milliseconds(_ date: Date) -> Int64 { Int64(date.timeIntervalSince1970 * 1000) }

    private func day(_ date: Date) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .current
        return String(format: "%04d-%02d-%02d", calendar.component(.year, from: date),
                      calendar.component(.month, from: date), calendar.component(.day, from: date))
    }
}

private struct RewardPassState {
    var adFreeUntil: Int64
    var lastExpiredRewardUntil: Int64
    var expiryNoticePendingUntil: Int64
    var redemptionDay: String
    var redemptionsToday: Int

    init(_ values: [String: Any], today: String) {
        adFreeUntil = (values["adFreeUntil"] as? NSNumber)?.int64Value ?? 0
        lastExpiredRewardUntil = (values["lastExpiredRewardUntil"] as? NSNumber)?.int64Value ?? 0
        expiryNoticePendingUntil = (values["expiryNoticePendingUntil"] as? NSNumber)?.int64Value ?? 0
        redemptionDay = values["redemptionDay"] as? String ?? today
        redemptionsToday = (values["redemptionsToday"] as? NSNumber)?.intValue ?? 0
    }
}

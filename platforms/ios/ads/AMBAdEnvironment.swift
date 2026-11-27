import StoreKit

struct AMBAdEnvironment {
    let verifiedEnvironment: AppStore.Environment?
    @MainActor private static let cache = AMBAdEnvironmentCache()

    @MainActor
    static func current() async -> AMBAdEnvironment {
        #if DEBUG || targetEnvironment(simulator)
        // Debug and simulator installs have no App Store app transaction.
        return AMBAdEnvironment(verifiedEnvironment: nil)
        #else
        return await cache.current {
            if case .verified(let transaction) = try await AppTransaction.shared {
                return transaction.environment
            }
            return nil
        }
        #endif
    }

    @MainActor
    static func resolve(timeout: Duration = .seconds(3),
                        lookup: @escaping () async throws -> AppStore.Environment?) async -> AMBAdEnvironment {
        // A task group would still wait for a StoreKit operation that ignores cancellation.
        await withCheckedContinuation { continuation in
            var pending: CheckedContinuation<AMBAdEnvironment, Never>? = continuation
            var deadline: Task<Void, Never>?
            let request = Task { @MainActor in
                let environment = try? await lookup()
                guard let completion = pending else { return }
                pending = nil
                deadline?.cancel()
                completion.resume(returning: AMBAdEnvironment(verifiedEnvironment: environment))
            }
            deadline = Task { @MainActor in
                do { try await Task.sleep(for: timeout) }
                catch { return }
                guard let completion = pending else { return }
                pending = nil
                request.cancel()
                completion.resume(returning: AMBAdEnvironment(verifiedEnvironment: nil))
            }
        }
    }

    func unitID(for format: String, configured: String) -> String {
        guard verifiedEnvironment == .sandbox || verifiedEnvironment == .xcode else { return configured }
        // Google's demo units are used only in Apple's verified testing environments.
        let suffix: String
        switch format {
        case "appOpen": suffix = "5575463023"
        case "banner": suffix = "2435281174"
        case "interstitial": suffix = "4411468910"
        case "rewarded": suffix = "1712485313"
        case "rewardedInterstitial": suffix = "6978759866"
        case "native": suffix = "3986624511"
        default: return configured
        }
        return "ca-app-pub-3940256099942544/" + suffix
    }
}

@MainActor
final class AMBAdEnvironmentCache {
    private var verified: AMBAdEnvironment?
    private var pending: Task<AMBAdEnvironment, Never>?
    private var retryAfter: ContinuousClock.Instant?
    private let now: () -> ContinuousClock.Instant

    init(now: @escaping () -> ContinuousClock.Instant = { .now }) { self.now = now }

    func current(lookup: @escaping () async throws -> AppStore.Environment?) async -> AMBAdEnvironment {
        if let verified { return verified }
        if let pending { return await pending.value }
        if let retryAfter, now() < retryAfter { return AMBAdEnvironment(verifiedEnvironment: nil) }
        let request = Task { await AMBAdEnvironment.resolve(lookup: lookup) }
        pending = request
        let result = await request.value
        pending = nil
        if result.verifiedEnvironment != nil { verified = result }
        else { retryAfter = now().advanced(by: .seconds(30)) }
        return result
    }
}

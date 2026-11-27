import StoreKit
import XCTest
@testable import runner

@MainActor
final class AdsStartupTests: XCTestCase {
    func testEnvironmentCacheCoalescesRequestsAndRetainsVerifiedResult() async {
        let cache = AMBAdEnvironmentCache()
        var complete: CheckedContinuation<AppStore.Environment?, Never>?
        let started = expectation(description: "StoreKit lookup started")
        let first = Task { @MainActor in
            await cache.current {
                await withCheckedContinuation { complete = $0; started.fulfill() }
            }
        }
        await fulfillment(of: [started], timeout: 1)
        let joined = expectation(description: "Second lookup joined")
        let second = Task { @MainActor in
            joined.fulfill()
            return await cache.current { XCTFail("Concurrent lookup must be coalesced"); return .production }
        }
        await fulfillment(of: [joined], timeout: 1)
        complete?.resume(returning: .sandbox)
        let firstResult = await first.value
        let secondResult = await second.value
        XCTAssertEqual(firstResult.verifiedEnvironment, .sandbox)
        XCTAssertEqual(secondResult.verifiedEnvironment, .sandbox)
        let cached = await cache.current { XCTFail("Verified result must be reused"); return nil }
        XCTAssertEqual(cached.verifiedEnvironment, .sandbox)
    }

    func testEnvironmentCacheRetriesFailuresAndUnverifiedResultsAfterCooldown() async {
        var instant = ContinuousClock.now
        let cache = AMBAdEnvironmentCache(now: { instant })
        let failed = await cache.current { throw URLError(.notConnectedToInternet) }
        XCTAssertNil(failed.verifiedEnvironment)
        let cooled = await cache.current { XCTFail("Retry must be throttled"); return .sandbox }
        XCTAssertNil(cooled.verifiedEnvironment)
        instant = instant.advanced(by: .seconds(30))
        let unverified = await cache.current { nil }
        XCTAssertNil(unverified.verifiedEnvironment)
        instant = instant.advanced(by: .seconds(30))
        let recovered = await cache.current { .sandbox }
        XCTAssertEqual(recovered.verifiedEnvironment, .sandbox)
    }

    func testOnlyVerifiedTestingEnvironmentsReplaceConfiguredUnits() {
        let formats = ["banner", "interstitial", "rewarded", "rewardedInterstitial", "appOpen", "native"]
        for environment: AppStore.Environment? in [nil, .production, .sandbox, .xcode] {
            let policy = AMBAdEnvironment(verifiedEnvironment: environment)
            for format in formats {
                let unit = policy.unitID(for: format, configured: "production-unit")
                if environment == .sandbox || environment == .xcode {
                    XCTAssertTrue(unit.hasPrefix("ca-app-pub-3940256099942544/"), format)
                } else { XCTAssertEqual(unit, "production-unit", format) }
            }
            XCTAssertEqual(policy.unitID(for: "webView", configured: "original"), "original")
        }
        XCTAssertEqual(AMBAdEnvironment(verifiedEnvironment: .sandbox).unitID(for: "rewarded", configured: "production"),
                       "ca-app-pub-3940256099942544/1712485313")
    }

    func testEnvironmentLookupPreservesSuccessAndFallsBackOnFailure() async {
        let verified = await AMBAdEnvironment.resolve { .sandbox }
        XCTAssertEqual(verified.verifiedEnvironment, .sandbox)
        let failed = await AMBAdEnvironment.resolve { throw URLError(.notConnectedToInternet) }
        XCTAssertNil(failed.verifiedEnvironment)
    }

    func testEnvironmentDeadlineDoesNotWaitForCancellationAndIgnoresLateResult() async {
        var completeLookup: CheckedContinuation<AppStore.Environment?, Never>?
        let started = expectation(description: "Lookup started")
        let completed = expectation(description: "Deadline releases startup")
        let request = Task { @MainActor in
            let result = await AMBAdEnvironment.resolve(timeout: .milliseconds(25)) {
                await withCheckedContinuation {
                    completeLookup = $0
                    started.fulfill()
                }
            }
            XCTAssertNil(result.verifiedEnvironment)
            completed.fulfill()
            return result
        }
        await fulfillment(of: [started, completed], timeout: 2)
        completeLookup?.resume(returning: .sandbox)
        let result = await request.value
        XCTAssertEqual(result.unitID(for: "rewarded", configured: "production"), "production")
    }
}

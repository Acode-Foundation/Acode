import AppTrackingTransparency
import UIKit
import XCTest
@testable import runner

@MainActor
final class TrackingAuthorizationTests: XCTestCase {
    private var appActive = false

    func testTrackingWaitsForActiveAppAndCoalescesRequests() async {
        appActive = false
        var calls = 0
        var callback: ((ATTrackingManager.AuthorizationStatus) -> Void)?
        let notifications = NotificationCenter()
        let requested = expectation(description: "ATT requested in foreground")
        let tracking = AMBTrackingAuthorization(status: { .notDetermined }, isActive: { self.appActive },
            notifications: notifications, request: { calls += 1; callback = $0; requested.fulfill() })
        let finished = expectation(description: "Both callers receive the decision")
        finished.expectedFulfillmentCount = 2
        for _ in 0..<2 {
            tracking.authorize { result in
                XCTAssertEqual(try? result.get(), .denied)
                finished.fulfill()
            }
        }
        XCTAssertEqual(calls, 0)
        appActive = true
        notifications.post(name: UIApplication.didBecomeActiveNotification, object: nil)
        await fulfillment(of: [requested], timeout: 2)
        XCTAssertEqual(calls, 1)
        callback?(.denied)
        await fulfillment(of: [finished], timeout: 2)
    }

    func testExistingTrackingDecisionsDoNotPromptAgain() {
        for status: ATTrackingManager.AuthorizationStatus in [.denied, .restricted, .authorized] {
            let tracking = AMBTrackingAuthorization(status: { status }, isActive: { false }, request: { _ in
                XCTFail("A decided permission must not prompt again")
            })
            var result: ATTrackingManager.AuthorizationStatus?
            tracking.authorize { result = try? $0.get() }
            XCTAssertEqual(result, status)
        }
    }

    func testUndeterminedResultCannotStartAdsAndAllowsRetry() async {
        var calls = 0
        let tracking = AMBTrackingAuthorization(status: { .notDetermined }, isActive: { true }, request: {
            calls += 1
            $0(calls == 1 ? .notDetermined : .authorized)
        })
        let failed = expectation(description: "No ad startup without ATT decision")
        tracking.authorize { result in
            if case .success = result { XCTFail("Unresolved ATT must not initialize ads") }
            failed.fulfill()
        }
        await fulfillment(of: [failed], timeout: 2)
        let retried = expectation(description: "Retry succeeds")
        tracking.authorize { result in
            XCTAssertEqual(try? result.get(), .authorized)
            retried.fulfill()
        }
        await fulfillment(of: [retried], timeout: 2)
        XCTAssertEqual(calls, 2)
    }

    func testResetCancelsCallerWithoutStartingAnOverlappingTrackingRequest() async {
        var requests = 0
        var reply: (@Sendable (ATTrackingManager.AuthorizationStatus) -> Void)?
        let tracking = AMBTrackingAuthorization(status: { .notDetermined }, isActive: { true }, request: {
            requests += 1
            reply = $0
        })
        var cancelled = false
        tracking.authorize { result in
            if case .failure = result { cancelled = true }
        }
        tracking.cancel()
        XCTAssertTrue(cancelled)
        let completed = expectation(description: "New caller receives the outstanding OS decision")
        tracking.authorize { result in
            XCTAssertEqual(try? result.get(), .denied)
            completed.fulfill()
        }
        XCTAssertEqual(requests, 1)
        reply?(.denied)
        await fulfillment(of: [completed], timeout: 2)
    }

    func testDeadlineFailsWaitersWithoutOverlappingOSRequestAndLateReplyCanRecover() async {
        var calls = 0
        var reply: (@Sendable (ATTrackingManager.AuthorizationStatus) -> Void)?
        let tracking = AMBTrackingAuthorization(status: { .notDetermined }, isActive: { true },
            timeout: .milliseconds(25), request: { calls += 1; reply = $0 })
        let timedOut = expectation(description: "Both callers time out without a decision")
        timedOut.expectedFulfillmentCount = 2
        for _ in 0..<2 {
            tracking.authorize { result in
                if case .success = result { XCTFail("Timeout is not authorization") }
                timedOut.fulfill()
            }
        }
        await fulfillment(of: [timedOut], timeout: 2)
        let recovered = expectation(description: "Retry uses the outstanding OS request")
        tracking.authorize { result in
            XCTAssertEqual(try? result.get(), .denied)
            recovered.fulfill()
        }
        XCTAssertEqual(calls, 1)
        reply?(.denied)
        await fulfillment(of: [recovered], timeout: 2)
    }

    func testDeadlineReadsDeterminedOSStatusWhenReplyIsLost() async {
        var current = ATTrackingManager.AuthorizationStatus.notDetermined
        var calls = 0
        let tracking = AMBTrackingAuthorization(status: { current }, isActive: { true },
            timeout: .milliseconds(25), request: { _ in calls += 1 })
        let completed = expectation(description: "Deadline uses OS status, not a fabricated decision")
        tracking.authorize { result in
            XCTAssertEqual(try? result.get(), .restricted)
            completed.fulfill()
        }
        current = .restricted
        await fulfillment(of: [completed], timeout: 2)
        XCTAssertEqual(calls, 1)
    }

    func testForegroundRechecksOSStatusEvenWithAnOutstandingRequest() async {
        var current = ATTrackingManager.AuthorizationStatus.notDetermined
        let notifications = NotificationCenter()
        let tracking = AMBTrackingAuthorization(status: { current }, isActive: { true },
            notifications: notifications, request: { _ in })
        let completed = expectation(description: "Foreground sees the lost callback's decision")
        tracking.authorize { result in
            XCTAssertEqual(try? result.get(), .denied)
            completed.fulfill()
        }
        current = .denied
        notifications.post(name: UIApplication.didBecomeActiveNotification, object: nil)
        await fulfillment(of: [completed], timeout: 2)
    }

    func testInactiveWaitIsBoundedAndCanRetryWhenActive() async {
        appActive = false
        var calls = 0
        let tracking = AMBTrackingAuthorization(status: { .notDetermined }, isActive: { self.appActive },
            timeout: .milliseconds(25), request: { calls += 1; $0(.denied) })
        let timedOut = expectation(description: "Inactive wait times out")
        tracking.authorize { result in
            if case .success = result { XCTFail("Inactive timeout must not start ads") }
            timedOut.fulfill()
        }
        await fulfillment(of: [timedOut], timeout: 2)
        XCTAssertEqual(calls, 0)
        appActive = true
        let completed = expectation(description: "Active retry succeeds")
        tracking.authorize { result in
            XCTAssertEqual(try? result.get(), .denied)
            completed.fulfill()
        }
        await fulfillment(of: [completed], timeout: 2)
        XCTAssertEqual(calls, 1)
    }

    func testCancelledRequestCanRecoverFromOSStatusAndStaleReplyCannotSettleNewRequest() async {
        var current = ATTrackingManager.AuthorizationStatus.notDetermined
        var replies: [@Sendable (ATTrackingManager.AuthorizationStatus) -> Void] = []
        let tracking = AMBTrackingAuthorization(status: { current }, isActive: { true }, request: { replies.append($0) })
        var cancelled = false
        tracking.authorize { result in
            if case .failure = result { cancelled = true }
        }
        tracking.cancel()
        XCTAssertTrue(cancelled)
        current = .denied
        var recovered: ATTrackingManager.AuthorizationStatus?
        tracking.authorize { recovered = try? $0.get() }
        XCTAssertEqual(recovered, .denied)
        XCTAssertEqual(replies.count, 1)

        current = .notDetermined
        let completed = expectation(description: "Only the new OS request settles the new caller")
        tracking.authorize { result in
            XCTAssertEqual(try? result.get(), .restricted)
            completed.fulfill()
        }
        XCTAssertEqual(replies.count, 2)
        replies[0](.authorized)
        replies[1](.restricted)
        await fulfillment(of: [completed], timeout: 2)
    }
}

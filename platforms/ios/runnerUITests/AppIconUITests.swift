import XCTest
import StoreKitTest

@MainActor
final class AppIconUITests: XCTestCase {
    func testChangeAndRestoreIconThroughSettings() async throws {
        continueAfterFailure = false
        let configuration = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "Iap", withExtension: "storekit"))
        let purchases = try SKTestSession(contentsOf: configuration)
        purchases.resetToDefaultState()
        purchases.clearTransactions()
        purchases.disableDialogs = true
        defer { purchases.clearTransactions(); purchases.resetToDefaultState() }
        _ = try await purchases.buyProduct(identifier: "acode_pro_new")
        let device = XCUIDevice.shared
        let originalOrientation = device.orientation
        defer { device.orientation = originalOrientation }
        device.orientation = .portrait
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US", "-acode-ui-testing"]
        app.launch()
        dismissIconNotice(app)
        let entry = app.webViews.staticTexts["App icon"].firstMatch
        if !entry.waitForExistence(timeout: 2) {
            let settings = app.webViews.staticTexts["Settings"].firstMatch
            if !settings.waitForExistence(timeout: 2) {
                let header = app.webViews.otherElements["banner"].firstMatch
                XCTAssertTrue(header.waitForExistence(timeout: 15), app.debugDescription)
                header.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.5)).tap()
            }
            XCTAssertTrue(settings.waitForExistence(timeout: 15), app.debugDescription)
            tapWhenReady(settings)
        }
        for icon in ["Default", "Pixel Party", "Default"] {
            let landscape = icon == "Pixel Party"
            device.orientation = landscape ? .landscapeLeft : .portrait
            let rotated = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                let frame = app.windows.firstMatch.frame
                return frame.width > 0 && (frame.width > frame.height) == landscape
            }, object: nil)
            await fulfillment(of: [rotated], timeout: 5)
            XCTAssertTrue(entry.waitForExistence(timeout: 5), app.debugDescription)
            scrollTo(entry, in: app)
            tapWhenReady(entry)
            let button = app.webViews.switches[icon].firstMatch
            XCTAssertTrue(button.waitForExistence(timeout: 5), app.debugDescription)
            if button.value as? String == "1" {
                tapWhenReady(app.webViews.buttons.matching(NSPredicate(format: "label ==[c] %@", "close")).firstMatch)
                continue
            }
            tapWhenReady(button)
            dismissIconNotice(app)
            XCTAssertTrue(app.wait(for: .runningForeground, timeout: 5))
            tapWhenReady(entry)
            let selected = app.webViews.switches[icon].firstMatch
            let saved = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", "1"), object: selected)
            await fulfillment(of: [saved], timeout: 5)
            tapWhenReady(app.webViews.buttons.matching(NSPredicate(format: "label ==[c] %@", "close")).firstMatch)
        }
        XCTAssertTrue(app.webViews.staticTexts["App icon"].firstMatch.exists)
    }

    private func tapWhenReady(_ element: XCUIElement) {
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate(format: "hittable == true"), object: element)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 15), .completed, element.debugDescription)
        element.tap()
    }

    private func scrollTo(_ element: XCUIElement, in app: XCUIApplication) {
        let webView = app.webViews.firstMatch
        for _ in 0..<8 {
            if element.isHittable { return }
            let below = element.frame.midY > webView.frame.midY
            let start = webView.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: below ? 0.7 : 0.4))
            let end = webView.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: below ? 0.4 : 0.7))
            start.press(forDuration: 0.05, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 0.2)
        }
    }

    private func dismissIconNotice(_ app: XCUIApplication) {
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let alert = app.alerts.firstMatch.waitForExistence(timeout: 2)
            ? app.alerts.firstMatch : springboard.alerts.firstMatch
        if alert.exists {
            XCTAssertTrue(alert.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "changed the icon")).firstMatch.exists)
            alert.buttons["OK"].tap()
        }
    }
}

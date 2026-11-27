import XCTest

@MainActor
final class WebContextMenuUITests: XCTestCase {
    func testHoldingAFileTabOpensItsExistingMenuOnRelease() async throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US", "-acode-ui-testing"]
        app.launch()
        let header = app.webViews.otherElements["banner"].firstMatch
        XCTAssertTrue(header.waitForExistence(timeout: 20), app.debugDescription)
        header.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.5)).tap()
        XCTAssertTrue(app.webViews.staticTexts["Save as"].firstMatch.waitForExistence(timeout: 5), app.debugDescription)
        let newFiles = app.webViews.staticTexts.matching(identifier: "New file")
        let newFile = newFiles.element(boundBy: newFiles.count - 1)
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate(format: "hittable == true"), object: newFile)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 5), .completed, app.debugDescription)
        newFile.tap()
        let input = app.webViews.textFields.firstMatch
        XCTAssertTrue(input.waitForExistence(timeout: 5), app.debugDescription)
        let name = "context-menu-" + UUID().uuidString.prefix(8) + ".html"
        input.tap()
        input.typeText(name)
        let confirm = app.webViews.buttons.matching(NSPredicate(format: "label ==[c] %@", "ok")).firstMatch
        XCTAssertTrue(confirm.waitForExistence(timeout: 5), app.debugDescription)
        confirm.tap()
        let tab = app.webViews.staticTexts.matching(identifier: name).element(boundBy: 1)
        XCTAssertTrue(tab.waitForExistence(timeout: 5), app.debugDescription)
        tab.press(forDuration: 0.75)
        let closeLeft = app.webViews.staticTexts["Close Left"].firstMatch
        let close = app.webViews.staticTexts["Close file"].firstMatch
        defer { if close.exists { close.tap() } }
        XCTAssertTrue(closeLeft.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertTrue(tab.exists, "The release click must not activate a menu item")
    }
}

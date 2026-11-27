import XCTest
@testable import runner

final class TerminalServerOriginTests: XCTestCase {
    func testAllowsAppPagesAndCallersWithoutAnOrigin() {
        XCTAssertTrue(TerminalServer.allows(origin: nil))
        XCTAssertTrue(TerminalServer.allows(origin: "acode://localhost"))
        XCTAssertTrue(TerminalServer.allows(origin: "https://localhost"))
    }

    func testRejectsPreviewBrowserAndOpaqueOrigins() {
        XCTAssertFalse(TerminalServer.allows(origin: "http://localhost:8158"))
        XCTAssertFalse(TerminalServer.allows(origin: "https://example.com"))
        XCTAssertFalse(TerminalServer.allows(origin: "null"))
        XCTAssertFalse(TerminalServer.allows(origin: "acode://localhost, https://example.com"))
    }
}

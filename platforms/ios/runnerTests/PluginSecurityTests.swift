import XCTest
@testable import runner

final class PluginSecurityTests: XCTestCase {
    func testSessionTokenAndPermissionIsolation() throws {
        let sessions = PluginSessions()
        let session = try sessions.establish()
        XCTAssertEqual(session.count, 64)
        XCTAssertThrowsError(try sessions.establish())
        XCTAssertThrowsError(try sessions.issue(session: "forged", pluginID: "first", manifest: "{}"))
        let first = try sessions.issue(session: session, pluginID: "first", manifest: "{\"permissions\":[\"network\"]}")
        let second = try sessions.issue(session: session, pluginID: "second", manifest: "{}")
        XCTAssertNotEqual(first, second)
        XCTAssertEqual(try sessions.permissions(for: first), ["network"])
        XCTAssertEqual(try sessions.permissions(for: second), [])
        XCTAssertEqual(try sessions.plugin(for: first), "first")
        XCTAssertThrowsError(try sessions.plugin(for: session))
        XCTAssertThrowsError(try sessions.issue(session: session, pluginID: "first", manifest: "invalid"))
        XCTAssertEqual(try sessions.permissions(for: first), ["network"])
        try sessions.invalidate(first)
        XCTAssertThrowsError(try sessions.plugin(for: first))
        XCTAssertEqual(try sessions.plugin(for: second), "second")
        sessions.reset()
        XCTAssertThrowsError(try sessions.plugin(for: second))
        XCTAssertThrowsError(try sessions.issue(session: session, pluginID: "first", manifest: "{}"))
        XCTAssertNotEqual(try sessions.establish(), session)
    }

    func testKeychainNamespacesPersistAndClearIndependently() throws {
        let namespace = "ios-test." + UUID().uuidString
        let first = SecretStore(namespace: namespace + ".one")
        let second = SecretStore(namespace: namespace + ".two")
        defer { try? first.clear(); try? second.clear() }
        try first.set("token", value: "first ✓")
        try second.set("token", value: "second")
        XCTAssertEqual(try SecretStore(namespace: namespace + ".one").get("token"), "first ✓")
        try first.set("token", value: "updated")
        XCTAssertEqual(try first.get("token"), "updated")
        try first.clear()
        XCTAssertEqual(try first.get("token", default: "missing"), "missing")
        XCTAssertEqual(try second.get("token"), "second")
        try second.remove("token")
        XCTAssertEqual(try second.get("token"), "")
    }
}

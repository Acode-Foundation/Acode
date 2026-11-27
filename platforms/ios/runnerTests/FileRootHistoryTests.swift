import XCTest
@testable import runner

final class FileRootHistoryTests: XCTestCase {
    func testOldPathsFollowTheirAuthorizedRootAcrossSeveralInstalls() throws {
        let suite = "app.acode.file-roots-test." + UUID().uuidString
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let original = URL(fileURLWithPath: "/previous-container/Documents")
        let middle = URL(fileURLWithPath: "/next-container/Documents")
        let current = AppFiles.shared.documents
        let filename = "relocation-" + UUID().uuidString + " # 日本語.txt"
        let file = current.appendingPathComponent(filename)
        try Data([0, 128, 255]).write(to: file)
        defer { try? FileManager.default.removeItem(at: file) }
        FileRootHistory(defaults: defaults).update(["persistent": original])
        FileRootHistory(defaults: defaults).update(["persistent": middle])
        let history = FileRootHistory(defaults: defaults)
        let roots = ["persistent": current]
        history.update(roots)
        for root in [original, middle, current] {
            let resolved = history.resolve(root.appendingPathComponent(filename), roots: roots)
            XCTAssertEqual(try Data(contentsOf: resolved), Data([0, 128, 255]))
        }
        let outside = URL(fileURLWithPath: original.path + "-other/private.txt")
        XCTAssertEqual(history.resolve(outside, roots: roots), outside)
        let traversal = original.appendingPathComponent("../../private.txt")
        XCTAssertThrowsError(try AppFiles.shared.resolve(history.resolve(traversal, roots: roots).absoluteString))
    }

    func testRevokedRootsAreNotReauthorizedAndNestedRootsUseTheClosestGrant() throws {
        let suite = "app.acode.file-roots-test." + UUID().uuidString
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let parent = URL(fileURLWithPath: "/old-provider/projects")
        let nested = parent.appendingPathComponent("nested")
        let history = FileRootHistory(defaults: defaults)
        history.update(["provider": parent, "nested": nested])
        let roots = ["provider": URL(fileURLWithPath: "/new-provider/projects"),
                     "nested": URL(fileURLWithPath: "/another-provider/nested")]
        history.update(roots)
        let old = nested.appendingPathComponent("index.html")
        XCTAssertEqual(history.resolve(old, roots: roots), roots["nested"]!.appendingPathComponent("index.html"))
        XCTAssertEqual(history.resolve(old, roots: [:]), old)
        XCTAssertTrue(history.replacements(roots: [:]).isEmpty)
        let pairs = history.replacements(roots: roots)
        XCTAssertEqual(pairs.first?["from"], nested.absoluteString)
        XCTAssertEqual(pairs.first?["to"], roots["nested"]?.absoluteString)
        let stillAuthorized = ["provider": parent, "nested": roots["nested"]!]
        XCTAssertEqual(history.resolve(old, roots: stillAuthorized), old)
        XCTAssertFalse(history.replacements(roots: stillAuthorized).contains { $0["from"] == nested.absoluteString })
    }
}

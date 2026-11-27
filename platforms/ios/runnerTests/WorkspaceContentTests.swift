import XCTest
@testable import runner

final class WorkspaceContentTests: XCTestCase {
    func testLargeContentIsNotTruncatedAndExplicitIncludesRaiseReadLimit() throws {
        let root = AppFiles.shared.cache.appendingPathComponent("index-content-" + UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
        defer { try? FileManager.default.removeItem(at: root) }
        let content = WorkspaceContent(database: try WorkspaceDatabase(url: root.appendingPathComponent("index.sqlite")))
        let file = root.appendingPathComponent("large.txt")
        let text = String(repeating: "a", count: 700000) + "end-marker"
        try Data(text.utf8).write(to: file)
        let job = WorkspaceJob()
        var entry = try WorkspaceEntry(url: file, root: root.absoluteString, parent: root.absoluteString, parentPath: "Fixture")
        XCTAssertNil(try content.index(entry, encoding: "UTF-8", job: job))
        XCTAssertEqual(try content.get(entry, overlays: [:], encoding: "UTF-8", useIndex: true, large: false, job: job), text)
        try Data(repeating: 97, count: 17 * 1024 * 1024).write(to: file)
        entry = try WorkspaceEntry(url: file, root: root.absoluteString, parent: root.absoluteString, parentPath: "Fixture")
        XCTAssertNil(try content.get(entry, overlays: [:], encoding: "UTF-8", useIndex: false, large: false, job: job))
        XCTAssertEqual(try content.get(entry, overlays: [:], encoding: "UTF-8", useIndex: false, large: true, job: job)?.utf16.count, 17 * 1024 * 1024)
        let outside = WorkspaceEntry(["url": "file:///etc/passwd", "name": "passwd", "mime": "text/plain"])
        XCTAssertThrowsError(try content.get(outside, overlays: [outside.url: "overlay"], encoding: "UTF-8", useIndex: false, large: false, job: job))
    }
}

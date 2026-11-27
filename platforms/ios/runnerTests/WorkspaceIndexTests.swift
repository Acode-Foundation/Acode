import XCTest
@testable import runner

final class WorkspaceIndexTests: XCTestCase {
    func testScanPaginationUpdatesPersistenceAndCancelledRollback() throws {
        let root = try fixture()
        defer { try? FileManager.default.removeItem(at: root) }
        let databaseURL = root.appendingPathComponent("index.sqlite")
        let project = root.appendingPathComponent("project", isDirectory: true)
        try FileManager.default.createDirectory(at: project, withIntermediateDirectories: false)
        let special = project.appendingPathComponent("100%_ '✓ #.txt")
        try Data("needle".utf8).write(to: special)
        let index = WorkspaceIndex(database: .success(try WorkspaceDatabase(url: databaseURL)))
        let options: [String: Any] = ["rootUrl": project.absoluteString, "title": "Project", "excludeFolders": ["ignored"], "indexContent": true]
        try index.scan(options, job: WorkspaceJob())
        for number in 0..<1200 { try Data("needle \(number)".utf8).write(to: project.appendingPathComponent("item-\(number).txt")) }
        for name in [".hidden", "ignored", "nested"] { try FileManager.default.createDirectory(at: project.appendingPathComponent(name), withIntermediateDirectories: false) }
        try Data("skip".utf8).write(to: project.appendingPathComponent("ignored/skip.txt"))
        try Data("include".utf8).write(to: project.appendingPathComponent("nested/child.txt"))
        try FileManager.default.createSymbolicLink(atPath: project.appendingPathComponent("nested/loop").path, withDestinationPath: project.path)
        weak var cancellingJob: WorkspaceJob?
        let cancelled = WorkspaceJob { type, _, _ in if type == "batch" { cancellingJob?.cancel() } }
        cancellingJob = cancelled
        XCTAssertThrowsError(try index.scan(options, job: cancelled))
        XCTAssertEqual(try entries(index, roots: [project.absoluteString]).count, 1)
        let start = Date()
        try index.scan(options, job: WorkspaceJob())
        XCTAssertLessThan(Date().timeIntervalSince(start), 15)
        let all = try entries(index, roots: [project.absoluteString])
        XCTAssertEqual(all.count, 1202)
        XCTAssertFalse(all.contains { ($0["path"] as? String)?.contains("ignored/") == true })
        let escaped = try index.query(["text": "%_", "roots": [project.absoluteString]])["entries"] as! [[String: Any]]
        XCTAssertEqual(escaped.map { $0["name"] as! String }, [special.lastPathComponent])
        let reloaded = WorkspaceIndex(database: .success(try WorkspaceDatabase(url: databaseURL)))
        XCTAssertEqual(try entries(reloaded, roots: [project.absoluteString]).count, all.count)
        let old = project.appendingPathComponent("nested", isDirectory: false)
        let renamed = project.appendingPathComponent("renamed", isDirectory: false)
        try FileManager.default.moveItem(at: old, to: renamed)
        let update = try index.update(["rootUrl": project.absoluteString, "removed": [old.absoluteString], "added": [["url": renamed.absoluteString, "parentUrl": project.absoluteString]], "excludeFolders": ["ignored"]])
        XCTAssertGreaterThan(update["removed"] as! Int, 0)
        XCTAssertGreaterThan(update["added"] as! Int, 0)
        XCTAssertEqual(try entries(index, roots: [project.absoluteString]).count, all.count)
        XCTAssertTrue(try entries(index, roots: [project.absoluteString]).contains { $0["path"] as? String == "Project/renamed/child.txt" })
        XCTAssertThrowsError(try index.update(["rootUrl": project.absoluteString, "removed": [root.appendingPathComponent("index.sqlite").absoluteString]]))
        try index.database.get().clear([project.absoluteString])
        XCTAssertTrue(try entries(index, roots: [project.absoluteString]).isEmpty)
    }

    func testSearchEncodingBinaryFiltersOverlaysCacheAndLiteralReplace() throws {
        let root = try fixture()
        defer { try? FileManager.default.removeItem(at: root) }
        let project = root.appendingPathComponent("project", isDirectory: true)
        try FileManager.default.createDirectory(at: project, withIntermediateDirectories: false)
        let file = project.appendingPathComponent("unicode.txt")
        try Data("😀 needle\r\nNEEDLE needleLong\n".utf8).write(to: file)
        try "wide needle".data(using: .utf16LittleEndian)!.write(to: project.appendingPathComponent("wide.txt"))
        try (Data([255, 254]) + "needle".data(using: .utf16LittleEndian)!).write(to: project.appendingPathComponent("bom.txt"))
        try Data([0, 1, 2, 3] + Array("needle".utf8)).write(to: project.appendingPathComponent("binary.unknown"))
        try Data("needle".utf8).write(to: project.appendingPathComponent("photo.png"))
        try Data("readme needle".utf8).write(to: project.appendingPathComponent("README"))
        let environment = project.appendingPathComponent(".env")
        try Data("env needle".utf8).write(to: environment)
        let index = WorkspaceIndex(database: .success(try WorkspaceDatabase(url: root.appendingPathComponent("index.sqlite"))))
        try index.scan(["rootUrl": project.absoluteString, "title": "Project", "indexContent": true], job: WorkspaceJob())
        var events: [(String, [String: Any])] = []
        let job = WorkspaceJob { type, value, _ in events.append((type, value)) }
        let openFile: [String: Any] = ["url": environment.absoluteString, "name": ".env", "path": "Project/.env", "mime": "application/octet-stream"]
        var options: [String: Any] = ["roots": [project.absoluteString], "files": [openFile], "search": "needle", "options": ["wholeWord": true], "batchResults": true, "useIndex": true]
        try index.search(options, job: job)
        let results = events.filter { $0.0 == "search-results" }.flatMap { $0.1["data"] as! [[String: Any]] }
        XCTAssertEqual(results.count, 5)
        let bomMatch = (results.first { ($0["file"] as? [String: Any])?["name"] as? String == "bom.txt" }!["matches"] as! [[String: Any]])[0]
        XCTAssertEqual((bomMatch["position"] as? [String: [String: Int]])?["start"]?["column"], 1)
        let matches = results.first { ($0["file"] as? [String: Any])?["name"] as? String == "unicode.txt" }!["matches"] as! [[String: Any]]
        XCTAssertEqual(matches.count, 2)
        let position = matches[0]["position"] as! [String: [String: Int]]
        XCTAssertEqual(position["start"], ["row": 0, "column": 3])
        XCTAssertEqual(position["end"], ["row": 0, "column": 9])
        events.removeAll()
        options["overlays"] = [file.absoluteString: "unsaved NEEDLE"]
        options["options"] = ["include": "**/unicode.txt", "exclude": "*.png"]
        options["mode"] = "replace"; options["replace"] = "$1\\literal"
        try index.search(options, job: job)
        XCTAssertEqual(events.first { $0.0 == "replace-result" }?.1["text"] as? String, "unsaved $1\\literal")
        XCTAssertEqual(try String(contentsOf: file, encoding: .utf8), "😀 needle\r\nNEEDLE needleLong\n")
        let entry = WorkspaceEntry((try index.query(["url": file.absoluteString]))["entries"].flatMap { $0 as? [[String: Any]] }!.first!)
        try Data("changed".utf8).write(to: file)
        let content = WorkspaceContent(database: try index.database.get())
        XCTAssertTrue(try content.get(entry, overlays: [:], encoding: "UTF-8", useIndex: true, large: false, job: job)!.contains("needle"))
        try index.database.get().execute("DELETE FROM content WHERE url = ?", [file.absoluteString])
        XCTAssertEqual(try content.get(entry, overlays: [:], encoding: "UTF-8", useIndex: true, large: false, job: job), "changed")
    }

    func testSearchBatchesLimitAndRegexDeadline() throws {
        let job = WorkspaceJob()
        let regex = try NSRegularExpression(pattern: "x")
        var sizes: [Int] = [], limited = false
        try WorkspaceMatches(text: String(repeating: "x ", count: 5001), regex: regex, job: job).search { matches, limit in sizes.append(matches.count); limited = limited || limit }
        XCTAssertEqual(sizes.reduce(0, +), 5000)
        XCTAssertTrue(sizes.allSatisfy { $0 == 200 })
        XCTAssertTrue(limited)
        let difficult = try NSRegularExpression(pattern: "(a+)+$")
        let start = Date()
        XCTAssertThrowsError(try WorkspaceMatches(text: String(repeating: "a", count: 100000) + "!", regex: difficult, job: job).search { _, _ in }) { error in
            XCTAssertTrue(error.localizedDescription.contains("timed out"))
        }
        XCTAssertLessThan(Date().timeIntervalSince(start), 5)
        let cancelled = WorkspaceJob(); cancelled.cancel()
        XCTAssertThrowsError(try WorkspaceMatches(text: "x", regex: regex, job: cancelled).search { _, _ in })
    }

    private func fixture() throws -> URL {
        let root = AppFiles.shared.cache.appendingPathComponent("workspace-tests-" + UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
        return root
    }

    private func entries(_ index: WorkspaceIndex, roots: [String]) throws -> [[String: Any]] {
        var result: [[String: Any]] = [], cursor = 0
        repeat {
            let page = try index.query(["roots": roots, "limit": 137, "cursor": cursor])
            result += page["entries"] as! [[String: Any]]
            guard page["hasMore"] as? Bool == true else { break }
            cursor = page["cursor"] as! Int
        } while true
        return result
    }
}

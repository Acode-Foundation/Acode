import XCTest
@testable import runner

final class FileServiceTests: XCTestCase {
    private let files = AppFiles.shared
    private var directory: URL!

    override func setUpWithError() throws {
        directory = files.cache.appendingPathComponent("ios-port-test-" + UUID().uuidString, isDirectory: true)
        try files.manager.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        if let directory { try files.manager.removeItem(at: directory) }
    }

    func testFileURLsRoundTripSpacesUnicodeAndFragments() throws {
        let url = directory.appendingPathComponent("test # 日本語.txt")
        try Data("hello ✓".utf8).write(to: url)
        let entry = try files.entry(url)
        let name = try XCTUnwrap(entry["filesystemName"] as? String)
        let path = try XCTUnwrap(entry["fullPath"] as? String)
        var components = URLComponents()
        components.scheme = "acode"
        components.host = "localhost"
        components.path = "/__cdvfile_\(name)__" + path
        let resolved = try files.resolve(XCTUnwrap(components.url?.absoluteString))
        XCTAssertEqual(resolved, url.standardizedFileURL.resolvingSymlinksInPath())
        XCTAssertEqual(try files.coordinate(resolved) { try String(contentsOf: $0, encoding: .utf8) }, "hello ✓")
        XCTAssertEqual(try files.metadata(resolved)["size"] as? Int, Data("hello ✓".utf8).count)
    }

    func testTraversalAndSymlinksCannotReadOutsideAuthorizedRoots() throws {
        XCTAssertThrowsError(try files.resolve("acode://localhost/__cdvfile_cache__/../../../../etc/passwd"))
        let link = directory.appendingPathComponent("outside")
        try files.manager.createSymbolicLink(at: link, withDestinationURL: URL(fileURLWithPath: "/etc"))
        XCTAssertThrowsError(try files.resolve(link.appendingPathComponent("passwd").absoluteString))
        XCTAssertThrowsError(try files.resolve("https://example.com/file"))
    }

    func testEncodingsRoundTripAndIncludeUTF8() throws {
        XCTAssertNotNil(FileContents.availableEncodings()["UTF-8"])
        for name in ["UTF-8", "UTF-16LE", "UTF-16BE", "UTF-32"] {
            let encoding = try FileContents.encoding(name)
            let bytes = try XCTUnwrap("Acode 日本語 ✓".data(using: encoding))
            XCTAssertEqual(String(data: bytes, encoding: encoding), "Acode 日本語 ✓")
        }
        XCTAssertThrowsError(try FileContents.encoding("not-an-encoding"))
    }
}

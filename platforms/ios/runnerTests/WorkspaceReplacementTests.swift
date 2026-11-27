import XCTest
@testable import runner

final class WorkspaceReplacementTests: XCTestCase {
    func testExpandsJavaScriptSubstitutions() throws {
        XCTAssertEqual(try replace("foo bar", #"(\w+) (\w+)"#, "$2 $1"), "bar foo")
        XCTAssertEqual(try replace("ab", "a", "[$&]"), "[a]b")
        XCTAssertEqual(try replace("xay", "a", "$`|$'"), "xx|yy")
        XCTAssertEqual(try replace("a", "a", "$$1"), "$1")
        XCTAssertEqual(try replace("abcdefghijk", "(a)(b)(c)(d)(e)(f)(g)(h)(i)(j)(k)", "$11-$10-$1"), "k-j-a")
        XCTAssertEqual(try replace("ab", "(a)(b)", "$3$0"), "$3$0")
    }

    func testNamedGroups() throws {
        XCTAssertEqual(try replace("2026-11", #"(?<year>\d+)-(?<month>\d+)"#, "$<month>/$<year>"), "11/2026")
        XCTAssertEqual(try replace("a", "(?<x>a)", "[$<missing>]"), "[]")
        XCTAssertEqual(try replace("a", "(a)", "$<x>"), "$<x>")
        XCTAssertEqual(try replace("a", "[(?<x>)]?(a)", "$<x>"), "$<x>")
        XCTAssertEqual(try replace("a", #"\Q(?<x>\E|(a)"#, "$<x>"), "$<x>")
    }

    func testLiteralModeLeavesReplacementUntouched() throws {
        let regex = try NSRegularExpression(pattern: NSRegularExpression.escapedPattern(for: "a"))
        let source = "a" as NSString
        let match = try XCTUnwrap(regex.firstMatch(in: source as String, range: NSRange(location: 0, length: source.length)))
        XCTAssertEqual(WorkspaceReplacement("$&$1", pattern: "a", regExp: false).expand(match, in: source), "$&$1")
    }

    private func replace(_ text: String, _ pattern: String, _ template: String) throws -> String {
        let regex = try NSRegularExpression(pattern: pattern)
        let source = text as NSString
        let replacement = WorkspaceReplacement(template, pattern: pattern, regExp: true)
        let out = NSMutableString()
        var cursor = 0
        for match in regex.matches(in: text, range: NSRange(location: 0, length: source.length)) {
            out.append(source.substring(with: NSRange(location: cursor, length: match.range.location - cursor)))
            out.append(replacement.expand(match, in: source))
            cursor = NSMaxRange(match.range)
        }
        out.append(source.substring(from: cursor))
        return out as String
    }
}

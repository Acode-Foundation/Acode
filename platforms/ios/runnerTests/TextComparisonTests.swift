import XCTest
import WebKit
@testable import runner

@MainActor
final class TextComparisonTests: BridgeTestCase {
    func testTextComparisonDetectsUnicodeNormalizationChanges() async throws {
        let app = try await editorWebView()
        let result = try await app.callAsyncJavaScript("""
            const pairs=[['é','e\\u0301'],['Å','A\\u030a'],['가','\\u1100\\u1161'],['a\\u0323\\u0301','a\\u0301\\u0323']];
            const failures=[];
            for(const [original,changed] of pairs){
                if(!await system.compareTexts(original,changed))failures.push('Missed change: '+JSON.stringify([original,changed]));
                if(await system.compareTexts(original,original))failures.push('Identical text changed');
            }
            if(await system.compareTexts(null,''))failures.push('Null did not default to empty text');
            if(await system.compareTexts('emoji 🧑‍💻\\r\\n','emoji 🧑‍💻\\r\\n'))failures.push('Identical emoji changed');
            if(!await system.compareTexts('line\\r\\n','line\\n'))failures.push('Missed line-ending change');
            return failures;
            """, arguments: [:], in: nil, contentWorld: .page) as? [String]
        XCTAssertEqual(result, [])
    }

    func testFileComparisonPreservesExactDecodedTextAcrossEncodings() async throws {
        let app = try await editorWebView()
        let directory = AppFiles.shared.cache.appendingPathComponent("text-comparison-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let original = "café 🧑‍💻\r\n"
        for encoding in ["UTF-8", "UTF-16LE", "UTF-16BE"] {
            let file = directory.appendingPathComponent(encoding + ".txt")
            let bytes = try XCTUnwrap(original.data(using: FileContents.encoding(encoding)))
            try bytes.write(to: file)
            let result = try await app.callAsyncJavaScript("""
                const changed=original.normalize('NFD');
                if(encoding==='UTF-8' && await system.compareFileText(uri,'',original))throw Error('Empty encoding did not use UTF-8');
                return {
                    equal:await system.compareFileText(uri,encoding,original),
                    changed:await system.compareFileText(uri,encoding,changed),
                    lineEnding:await system.compareFileText(uri,encoding,original.replace('\\r\\n','\\n'))
                };
                """, arguments: ["uri": "file://" + file.path, "encoding": encoding, "original": original], in: nil, contentWorld: .page) as? [String: Bool]
            XCTAssertEqual(result?["equal"], false, encoding)
            XCTAssertEqual(result?["changed"], true, encoding)
            XCTAssertEqual(result?["lineEnding"], true, encoding)
        }
    }
}

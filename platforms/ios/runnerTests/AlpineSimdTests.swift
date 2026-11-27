import XCTest
import WebKit

@MainActor
final class AlpineSimdTests: BridgeTestCase {
    func testHalfwordLaneLoadsAndStores() async throws {
        let fixture = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "halfword-lanes", withExtension: "elf"))
        let payload = try Data(contentsOf: fixture).base64EncodedString()
        let webView = try await editorWebView()
        let result = try await webView.callAsyncJavaScript(#"""
            if (!await Terminal.isInstalled() && !await Terminal.install()) throw new Error(Terminal.lastInstallError);
            return await Executor.execute(`set -eu
                dir=$(mktemp -d /tmp/acode-simd-test.XXXXXX)
                trap 'rm -rf "$dir"' EXIT
                printf '%s' '${payload}' | base64 -d > "$dir/probe"
                chmod 755 "$dir/probe"
                "$dir/probe"`, true);
            """#, arguments: ["payload": payload], in: nil, contentWorld: .page) as? String
        XCTAssertEqual(result, "SIMD_PASS")
    }
}

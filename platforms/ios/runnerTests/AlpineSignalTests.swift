import XCTest
import WebKit

@MainActor
final class AlpineSignalTests: BridgeTestCase {
    func testFaultSignalsAndQueuedSignals() async throws {
        let fixture = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "fault-signals", withExtension: "elf"))
        let payload = try Data(contentsOf: fixture).base64EncodedString()
        let webView = try await editorWebView()
        let result = try await webView.callAsyncJavaScript(#"""
            if (!await Terminal.isInstalled() && !await Terminal.install()) throw new Error(Terminal.lastInstallError);
            return await Executor.execute(`
                dir=$(mktemp -d /tmp/acode-signal-test.XXXXXX) || exit 1
                trap 'rm -rf "$dir"' EXIT
                printf '%s' '${payload}' | base64 -d > "$dir/probe" || exit 1
                chmod 755 "$dir/probe" || exit 1
                for signal in s i; do
                    for mode in b i h q; do
                        timeout -s KILL 3 "$dir/probe" "$mode" "$signal" >/dev/null 2>&1
                        printf '%s:%s:%s\\n' "$signal" "$mode" "$?"
                    done
                done`, true);
            """#, arguments: ["payload": payload], in: nil, contentWorld: .page) as? String
        XCTAssertEqual(result, "s:b:139\ns:i:139\ns:h:42\ns:q:42\ni:b:132\ni:i:132\ni:h:42\ni:q:42")
    }
}

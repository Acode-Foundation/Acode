import XCTest
import WebKit
@testable import runner

@MainActor
final class InAppRunnerTests: BridgeTestCase {
    func testExecutorAndQuickToolsRegressionsInAppRunner() async throws {
        let webView = try await editorWebView()
        let result = try await webView.callAsyncJavaScript("""
            await acode.exec('run-tests');
            for (let n = 0; n < 600; n++) {
                const tab = editorManager.getFile('test-runner');
                const page = tab?.content.shadowRoot?.querySelector('#test-runner-page');
                if (page && !page.querySelector('.run-btn').disabled) {
                    return [...page.querySelectorAll('.test-item')].map(item => ({
                        name: item.querySelector('.test-name').textContent,
                        passed: !!item.querySelector('.check_circle'),
                        skipped: !!item.querySelector('.warningreport_problem'),
                        error: item.querySelector('.test-error-block')?.textContent || ''
                    }));
                }
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            throw Error('In-app tests did not finish');
            """, arguments: [:], in: nil, contentWorld: .page) as? [[String: Any]]
        let tests = try XCTUnwrap(result)
        let attachment = XCTAttachment(string: String(data: try JSONSerialization.data(withJSONObject: tests, options: [.prettyPrinted]), encoding: .utf8)!)
        attachment.name = "In-app test results"
        attachment.lifetime = .keepAlways
        add(attachment)
        for name in ["Quick tools Ctrl+Right moves by word", "Quick tools Ctrl+Shift+Right selects by word", "Quick tools unsupported key falls back"] {
            let test = try XCTUnwrap(tests.first { $0["name"] as? String == name })
            XCTAssertEqual(test["passed"] as? Bool, true, "\(name): \(test["error"] ?? "")")
        }
        let fdroid = try XCTUnwrap(tests.first { $0["name"] as? String == "FDROID env variable" })
        XCTAssertEqual(fdroid["skipped"] as? Bool, true)
        XCTAssertEqual(fdroid["error"] as? String, "FDROID is only used on Android")
    }
}

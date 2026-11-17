import XCTest
import WebKit
@testable import runner

@MainActor
final class ShareTests: BridgeTestCase {
    func testFileExportsAreIsolatedAndRemovedAfterCancellationOrReload() async throws {
        try await verifyFileSharing(service: "System")
    }

    func testNativeFileExportsSurviveUntilDismissalAndAreRemovedOnReload() async throws {
        try await verifyFileSharing(service: "Native")
    }

    func testRepeatedBridgeSetupRetainsShareOwnerAndCleansPresentedExport() async throws {
        try await verifyFileSharing(service: "Native", repeatSetup: true)
    }

    func testNativeTextSharingPresentsAndCompletes() async throws {
        let webView = try await appWebView()
        var responder: UIResponder? = webView
        while responder != nil, !(responder is WebViewController) { responder = responder?.next }
        let host = try XCTUnwrap(responder as? WebViewController)
        _ = try await webView.evaluateJavaScript("""
            window.shareResult={state:'pending'};
            Bridge.exec(()=>window.shareResult={state:'success'},error=>window.shareResult={state:'error',error},
                'Native','shareText',['Share fixture']);
            """)
        let presented = try await sheet(host)
        presented.completionWithItemsHandler?(nil, false, nil, nil)
        await dismiss(presented)
        let response = try await result(webView)
        XCTAssertEqual(response["state"] as? String, "success")
    }

    private func verifyFileSharing(service: String, repeatSetup: Bool = false) async throws {
        let webView = try await appWebView()
        var responder: UIResponder? = webView
        while responder != nil, !(responder is WebViewController) { responder = responder?.next }
        let host = try XCTUnwrap(responder as? WebViewController)
        let files = AppFiles.shared
        let source = files.documents.appendingPathComponent("share-fixture-" + UUID().uuidString + ".bin")
        let bytes = Data([0, 127, 128, 255, 10])
        try bytes.write(to: source)
        defer { try? files.manager.removeItem(at: source) }
        let original = try exports()
        try await begin(webView, service: service, path: source.absoluteString)
        let first = try await sheet(host)
        let exported = try XCTUnwrap(try exports().subtracting(original).first)
        let copy = exported.appendingPathComponent("shared # 日本語.bin")
        XCTAssertEqual(try Data(contentsOf: copy), bytes)
        try Data([1, 2, 3]).write(to: source)
        XCTAssertEqual(try Data(contentsOf: copy), bytes)

        try await begin(webView, service: service == "Native" ? "System" : "Native", path: source.absoluteString, key: "busyShare")
        let busy = try await result(webView, key: "busyShare")
        XCTAssertEqual(busy["error"] as? String, "A share sheet cannot be presented right now")
        XCTAssertEqual(try exports().subtracting(original), [exported])
        first.completionWithItemsHandler?(nil, false, nil, nil)
        await dismiss(first)
        let cancelled = try await result(webView)
        XCTAssertEqual(cancelled["state"] as? String, "success")
        XCTAssertEqual(try exports(), original)

        try await begin(webView, service: service, path: source.absoluteString)
        let pending = try await sheet(host)
        if repeatSetup {
            let owner = host.bridge.shareService
            host.bridge.setup(webView: webView, viewController: host)
            XCTAssertTrue(host.bridge.shareService === owner)
        }
        webView.reload()
        for _ in 0..<100 {
            if host.presentedViewController == nil { break }
            try await Task.sleep(for: .milliseconds(50))
        }
        XCTAssertNil(host.presentedViewController, "Reload must dismiss the old share sheet")
        XCTAssertEqual(try exports(), original, "Reload must remove temporary exports")
        if host.presentedViewController != nil {
            pending.completionWithItemsHandler?(nil, false, nil, nil)
            await dismiss(pending)
        }
        _ = try await editorWebView()
    }

    private func begin(_ webView: WKWebView, service: String, path: String, key: String = "shareResult") async throws {
        _ = try await webView.callAsyncJavaScript("""
            window[key]={state:'pending'};
            Bridge.exec(()=>window[key]={state:'success'},error=>window[key]={state:'error',error},
                service,service==='Native'?'shareFile':'file-action',[path,'shared # 日本語.bin','android.intent.action.SEND']);
            """, arguments: ["service": service, "path": path, "key": key], in: nil, contentWorld: .page)
    }

    private func exports() throws -> Set<URL> {
        Set(try FileManager.default.contentsOfDirectory(at: AppFiles.shared.temporary, includingPropertiesForKeys: nil)
            .filter { $0.lastPathComponent.hasPrefix("share-") })
    }

    private func result(_ webView: WKWebView, key: String = "shareResult") async throws -> [String: Any] {
        let value = try await webView.callAsyncJavaScript("""
            for(let n=0;window[key].state==='pending'&&n<100;n++)await new Promise(r=>setTimeout(r,50));
            return window[key];
            """, arguments: ["key": key], in: nil, contentWorld: .page)
        let result = try XCTUnwrap(value as? [String: Any])
        XCTAssertNotEqual(result["state"] as? String, "pending")
        return result
    }

    private func sheet(_ host: UIViewController) async throws -> UIActivityViewController {
        for _ in 0..<100 {
            if let sheet = host.presentedViewController as? UIActivityViewController, !sheet.isBeingPresented { return sheet }
            try await Task.sleep(for: .milliseconds(50))
        }
        throw NSError(domain: "AcodeTests", code: 1, userInfo: [NSLocalizedDescriptionKey: "Share sheet not presented"])
    }

    private func dismiss(_ controller: UIViewController) async {
        await withCheckedContinuation { continuation in controller.dismiss(animated: false) { continuation.resume() } }
    }
}

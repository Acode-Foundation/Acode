import XCTest
import WebKit
@testable import runner

@MainActor
class BridgeTestCase: XCTestCase {
    override func setUp() async throws {
        let webView = try await appWebView()
        let marker = "iosConsentFixture"
        let scripts = webView.configuration.userContentController
        guard !scripts.userScripts.contains(where: { $0.source.contains(marker) }) else { return }
        SimulatorTestSupport.disableConsent(in: scripts)
        try await reloadWebView(webView)
    }

    func appWebView() async throws -> WKWebView {
        for _ in 0..<100 {
            for scene in UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }) {
                for window in scene.windows {
                    if let webView = findWebView(window), webView.url?.scheme == "acode", !webView.isLoading,
                       (try? await webView.evaluateJavaScript("!!window.Bridge")) as? Bool == true { return webView }
                }
            }
            try await Task.sleep(for: .milliseconds(100))
        }
        throw NSError(domain: "AcodeTests", code: 1, userInfo: [NSLocalizedDescriptionKey: "App WebView not mounted"])
    }

    func editorWebView() async throws -> WKWebView {
        let webView = try await appWebView()
        for _ in 0..<150 {
            if (try? await webView.evaluateJavaScript("!!window.acode && !!window.editorManager && !document.body.classList.contains('loading')")) as? Bool == true { return webView }
            try await Task.sleep(for: .milliseconds(100))
        }
        throw NSError(domain: "AcodeTests", code: 2, userInfo: [NSLocalizedDescriptionKey: "Editor startup did not finish"])
    }

    func reloadWebView(_ webView: WKWebView) async throws {
        let marker = UUID().uuidString
        _ = try await webView.evaluateJavaScript("window.iosTestReloadMarker='\(marker)'")
        webView.reload()
        for _ in 0..<150 {
            if !webView.isLoading,
               (try? await webView.evaluateJavaScript("window.iosTestReloadMarker!=='\(marker)' && !!window.Bridge")) as? Bool == true { return }
            try await Task.sleep(for: .milliseconds(100))
        }
        throw NSError(domain: "AcodeTests", code: 3, userInfo: [NSLocalizedDescriptionKey: "App WebView did not finish reloading"])
    }

    private func findWebView(_ view: UIView) -> WKWebView? {
        if let webView = view as? WKWebView, webView.url?.scheme == "acode" { return webView }
        for child in view.subviews { if let found = findWebView(child) { return found } }
        return nil
    }
}

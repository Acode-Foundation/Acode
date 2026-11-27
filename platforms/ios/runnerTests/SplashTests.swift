import XCTest
import WebKit
@testable import runner

@MainActor
final class SplashTests: BridgeTestCase {
    func testNativeBackgroundMatchesLaunchColorBeforeWebContentLoads() async throws {
        let controller = WebViewController()
        controller.loadViewIfNeeded()
        controller.webView.stopLoading()
        // Keep the fixture alive until native service initialization finishes.
        try await Task.sleep(for: .milliseconds(100))
        let expected = try XCTUnwrap(UIColor(hexString: "#20202c"))
        let launch = try XCTUnwrap(Bundle.main.infoDictionary?["UILaunchScreen"] as? [String: String])
        let color = try XCTUnwrap(UIColor(named: try XCTUnwrap(launch["UIColorName"])))
        XCTAssertEqual(color.cgColor.components, expected.cgColor.components)
        XCTAssertEqual(controller.view.backgroundColor, color)
        XCTAssertEqual(controller.webView.backgroundColor, color)
    }

    func testSplashUpdatesBothSafeAreasBeforeEditorStartup() async throws {
        let webView = try await editorWebView()
        var responder: UIResponder? = webView
        while responder != nil, !(responder is WebViewController) { responder = responder?.next }
        let controller = try XCTUnwrap(responder as? WebViewController)
        let originalColor = try await webView.evaluateJavaScript("localStorage.getItem('__primary_color')")
        let storage = String(data: try JSONSerialization.data(withJSONObject: [originalColor]), encoding: .utf8)!
        let scripts = webView.configuration.userContentController
        // WebKit's bridged array changes when scripts are removed; materialize a snapshot.
        let originalScripts = scripts.userScripts.map { $0 }
        defer {
            scripts.removeAllUserScripts()
            originalScripts.forEach(scripts.addUserScript)
            webView.evaluateJavaScript("const saved=\(storage)[0];if(saved===null)localStorage.removeItem('__primary_color');else localStorage.setItem('__primary_color',saved);") { _, _ in webView.reload() }
        }

        for saved in ["", "rgb(35, 39, 42)", "#ffffff"] {
            scripts.removeAllUserScripts()
            originalScripts.forEach(scripts.addUserScript)
            scripts.addUserScript(WKUserScript(source: """
                \(saved.isEmpty ? "localStorage.removeItem('__primary_color');" : "localStorage.setItem('__primary_color','\(saved)');")
                Object.defineProperty(window,'nativeReady',{configurable:true,get:()=>new Promise(()=>{}),set:()=>{}});
                """, injectionTime: .atDocumentStart, forMainFrameOnly: true))
            webView.reload()
            try await Task.sleep(for: .milliseconds(200))
            _ = try await appWebView()
            let result = try await webView.evaluateJavaScript("getComputedStyle(document.documentElement).backgroundColor")
            let background = try XCTUnwrap(result as? String)
            let components = background.split(whereSeparator: { !$0.isNumber && $0 != "." }).compactMap { Double($0) }
            let color = UIColor(red: components[0] / 255, green: components[1] / 255, blue: components[2] / 255, alpha: 1)
            for _ in 0..<50 {
                if controller.view.backgroundColor == color { break }
                try await Task.sleep(for: .milliseconds(20))
            }
            let loading = try await webView.evaluateJavaScript("document.body.classList.contains('loading')") as? Bool
            XCTAssertEqual(loading, true)
            XCTAssertEqual(controller.view.backgroundColor, color, saved)
            XCTAssertEqual(webView.backgroundColor, color, saved)
            XCTAssertEqual(webView.window?.backgroundColor, color, saved)
            let window = try XCTUnwrap(webView.window)
            let image = UIGraphicsImageRenderer(bounds: window.bounds).image { _ in
                window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
            }
            let screenshot = XCTAttachment(image: image)
            screenshot.name = "Splash \(saved.isEmpty ? "default" : saved)"
            screenshot.lifetime = .keepAlways
            add(screenshot)
        }
    }
}

import XCTest
import WebKit
@testable import runner

@MainActor
final class PreviewBrowserTests: BridgeTestCase {
    func testConsoleFocusKeepsScaleAndFitsAboveKeyboard() async throws {
        let app = try await editorWebView()
        var responder: UIResponder? = app
        while responder != nil, !(responder is WebViewController) { responder = responder?.next }
        let controller = try XCTUnwrap(responder as? WebViewController)
        _ = try await app.evaluateJavaScript("acode.exec('console')")
        let browser = try await presentedBrowser(controller)
        do {
            try await waitForPage(browser.webView, expression: "Boolean(document.querySelector('#__c-input'))")
            XCTAssertEqual(browser.address.text, "Console")
            XCTAssertNil(browser.menuButton.superview)
            assertCompactHeader(browser, screenshot: "console")
            await waitForKeyboardToHide(browser)
            let initialHeight = browser.content.bounds.height
            let result = try await browser.webView.callAsyncJavaScript("""
                const input=document.querySelector('#__c-input');
                const initialScale=visualViewport.scale;
                input.focus();
                await new Promise(resolve=>setTimeout(resolve,800));
                return {fontSize:parseFloat(getComputedStyle(input).fontSize),initialScale,
                    scale:visualViewport.scale,focused:document.activeElement===input};
                """, arguments: [:], in: nil, contentWorld: .page) as? [String: Any]
            XCTAssertEqual(result?["focused"] as? Bool, true)
            XCTAssertGreaterThanOrEqual(try XCTUnwrap(result?["fontSize"] as? Double), 16)
            XCTAssertEqual(try XCTUnwrap(result?["scale"] as? Double), try XCTUnwrap(result?["initialScale"] as? Double), accuracy: 0.01)
            XCTAssertLessThan(browser.content.bounds.height, initialHeight, "The software keyboard must actually appear")
            attachScreenshot(browser, name: "console-keyboard")
            _ = try await browser.webView.evaluateJavaScript("document.querySelector('#__c-input').blur()")
            await waitForKeyboardToHide(browser)
            XCTAssertEqual(browser.content.bounds.height, initialHeight, accuracy: 1)
            await withCheckedContinuation { continuation in browser.dismiss(animated: false) { continuation.resume() } }
        } catch {
            controller.presentedViewController?.dismiss(animated: false)
            throw error
        }
    }

    func testUnsavedEditorFileRunsInIsolatedBrowserWithConsoleAndViewportControls() async throws {
        let app = try await appWebView()
        let port = Int.random(in: 49152...60000)
        _ = try await app.callAsyncJavaScript("""
            for(let n=0;!window.editorManager&&n<100;n++) await new Promise(resolve=>setTimeout(resolve,100));
            const settings=acode.require('settings');
            const file=new (acode.require('EditorFile'))('preview-fixture.html',{text:'<!doctype html><title>Preview fixture</title><h1>Unsaved ✓</h1><script>window.consoleShows=0;document.addEventListener("showconsole",()=>consoleShows++);</script>',isUnsaved:true});
            window.previewTestState={file,settings,original:{serverPort:settings.value.serverPort,previewPort:settings.value.previewPort,previewMode:settings.value.previewMode,console:settings.value.console},tutorial:localStorage.__init_runPreview};
            Object.assign(settings.value,{serverPort:port,previewPort:port,previewMode:'inapp',console:settings.CONSOLE_LEGACY});
            localStorage.__init_runPreview='true';
            file.makeActive();
            file.runFile();
            """, arguments: ["port": port], in: nil, contentWorld: .page)
        var responder: UIResponder? = app
        while responder != nil, !(responder is WebViewController) { responder = responder?.next }
        let controller = try XCTUnwrap(responder as? WebViewController)
        do {
            let browser = try await presentedBrowser(controller)
            try await waitForPage(browser.webView, expression: "document.querySelector('h1')?.textContent === 'Unsaved ✓'")
            let titleReady = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                browser.address.text == "Preview fixture" && !browser.webView.isLoading
            }, object: nil)
            await fulfillment(of: [titleReady], timeout: 5)
            XCTAssertEqual(browser.address.text, "Preview fixture")
            assertCompactHeader(browser, screenshot: "browser")
            XCTAssertTrue(browser.address.becomeFirstResponder())
            XCTAssertEqual(browser.address.text, browser.webView.url?.absoluteString)
            browser.address.resignFirstResponder()
            XCTAssertEqual(browser.address.text, "Preview fixture")
            let isolated = try await browser.webView.evaluateJavaScript("!window.Bridge && !window.webkit?.messageHandlers?.exec") as? Bool
            XCTAssertEqual(isolated, true)
            try await waitForPage(browser.webView, expression: "Boolean(document.querySelector('c-toggler'))")
            browser.setConsoleVisible(true)
            try await waitForPage(browser.webView, expression: "window.consoleShows === 1")
            browser.applyViewport(CGSize(width: 768, height: 1024))
            browser.view.layoutIfNeeded()
            XCTAssertEqual(browser.webView.bounds.size, CGSize(width: 768, height: 1024))
            try await waitForPage(browser.webView, expression: "window.innerWidth === 768")
            XCTAssertFalse(browser.consoleVisible)
            _ = try await browser.webView.evaluateJavaScript("void document.documentElement.requestFullscreen()")
            for _ in 0..<100 {
                if browser.webView.fullscreenState == .inFullscreen { break }
                try await Task.sleep(for: .milliseconds(20))
            }
            XCTAssertEqual(browser.webView.fullscreenState, .inFullscreen)
            browser.view.setNeedsLayout()
            browser.view.layoutIfNeeded()
            let fullscreenWindow = try XCTUnwrap(browser.webView.window)
            let fullscreenFrame = browser.webView.convert(browser.webView.bounds, to: fullscreenWindow)
            XCTAssertEqual(fullscreenFrame.width, fullscreenWindow.bounds.width, accuracy: 1)
            XCTAssertEqual(fullscreenFrame.height, fullscreenWindow.bounds.height, accuracy: 1)
            _ = try await browser.webView.evaluateJavaScript("void document.exitFullscreen()")
            for _ in 0..<100 {
                if browser.webView.fullscreenState == .notInFullscreen { break }
                try await Task.sleep(for: .milliseconds(20))
            }
            XCTAssertEqual(browser.webView.fullscreenState, .notInFullscreen)
            browser.view.layoutIfNeeded()
            XCTAssertEqual(browser.webView.bounds.size, CGSize(width: 768, height: 1024))
            browser.applyViewport(nil)
            browser.view.layoutIfNeeded()
            XCTAssertEqual(browser.webView.bounds.size, browser.content.bounds.size)
            let window = try XCTUnwrap(browser.view.window)
            let frame = browser.webView.convert(browser.webView.bounds, to: window)
            XCTAssertGreaterThanOrEqual(frame.minY, window.safeAreaInsets.top)
            XCTAssertLessThanOrEqual(frame.maxY, window.bounds.height - window.safeAreaInsets.bottom)
            browser.webView.stopLoading()
            await withCheckedContinuation { continuation in browser.dismiss(animated: false) { continuation.resume() } }
        } catch {
            controller.presentedViewController?.dismiss(animated: false)
            try? await cleanup(app, port: port)
            throw error
        }
        try await cleanup(app, port: port)
    }

    func presentedBrowser(_ controller: WebViewController) async throws -> PreviewViewController {
        for _ in 0..<100 {
            if let browser = controller.presentedViewController as? PreviewViewController, !browser.isBeingPresented { return browser }
            try await Task.sleep(for: .milliseconds(100))
        }
        throw NSError(domain: "AcodeTests", code: 2, userInfo: [NSLocalizedDescriptionKey: "Preview not presented"])
    }

    private func assertCompactHeader(_ browser: PreviewViewController, screenshot: String) {
        browser.view.layoutIfNeeded()
        XCTAssertEqual(browser.toolbar.bounds.height, 45, accuracy: 0.5)
        XCTAssertEqual(browser.content.frame.minY, browser.toolbar.frame.maxY, accuracy: 0.5)
        XCTAssertEqual(browser.address.convert(browser.address.bounds, to: browser.view).midY, browser.toolbar.frame.midY, accuracy: 0.5)
        for button in browser.toolbar.arrangedSubviews.compactMap({ $0 as? UIButton }) {
            XCTAssertNotNil(button.image(for: .normal), "Missing icon: \(button.accessibilityLabel ?? "")")
        }
        attachScreenshot(browser, name: screenshot)
    }

    func attachScreenshot(_ browser: PreviewViewController, name: String) {
        guard let window = browser.view.window else { return }
        let image = UIGraphicsImageRenderer(bounds: window.bounds).image { _ in window.drawHierarchy(in: window.bounds, afterScreenUpdates: true) }
        let attachment = XCTAttachment(image: image)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func waitForPage(_ webView: WKWebView, expression: String) async throws {
        for _ in 0..<100 {
            if !webView.isLoading, (try? await webView.evaluateJavaScript(expression)) as? Bool == true { return }
            try await Task.sleep(for: .milliseconds(100))
        }
        let contents = try? await webView.evaluateJavaScript("document.body.innerText")
        throw NSError(domain: "AcodeTests", code: 3, userInfo: [NSLocalizedDescriptionKey: "Preview failed: \(expression); \(String(describing: contents))"])
    }

    private func waitForKeyboardToHide(_ browser: PreviewViewController) async {
        let hidden = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            browser.view.layoutIfNeeded()
            return browser.content.bounds.height > 0 &&
                abs(browser.content.frame.maxY - browser.view.safeAreaLayoutGuide.layoutFrame.maxY) < 1
        }, object: nil)
        await fulfillment(of: [hidden], timeout: 5)
    }

    private func cleanup(_ app: WKWebView, port: Int) async throws {
        _ = try await app.callAsyncJavaScript("""
            const state=window.previewTestState;
            Object.assign(state.settings.value,state.original);
            if(state.tutorial===undefined) delete localStorage.__init_runPreview;
            else localStorage.__init_runPreview=state.tutorial;
            await state.file.remove(true);
            delete window.previewTestState;
            await new Promise(resolve=>Bridge.exec(resolve,resolve,'Server','stop',[port]));
            """, arguments: ["port": port], in: nil, contentWorld: .page)
    }
}

import XCTest
import WebKit
@testable import runner

@MainActor
final class PreviewTransferTests: BridgeTestCase {
    func testClosingPreviewCancelsUnconfirmedDownload() async throws {
        let server = try HTTPFixture()
        try await server.start()
        defer { server.stop() }
        let browser = try await presentBrowser(server.origin + "/preview-transfers")
        _ = try await browser.webView.evaluateJavaScript("document.querySelector('a').click()")
        for _ in 0..<100 {
            if browser.pendingDialog != nil { break }
            try await Task.sleep(for: .milliseconds(50))
        }
        XCTAssertEqual(browser.activeDialog?.title, "Download file")
        XCTAssertNotNil(browser.pendingDialog)
        XCTAssertTrue(PreviewDownloadManager.shared.transfers.isEmpty)
        await close(browser)
        try await Task.sleep(for: .milliseconds(400))
        XCTAssertNil(browser.pendingDialog)
        XCTAssertNil(browser.activeDialog)
        XCTAssertTrue(PreviewDownloadManager.shared.transfers.isEmpty)
        XCTAssertFalse(FileManager.default.fileExists(atPath: AppFiles.shared.documents.appendingPathComponent("Downloads/" + server.downloadName).path))
    }

    func testClosingPreviewCancelsQueuedCacheNavigation() async throws {
        let server = try HTTPFixture()
        try await server.start()
        defer { server.stop() }
        let browser = try await presentBrowser(server.origin + "/page")
        browser.auxiliaryPresenter = browser.presentingViewController
        browser.disableCache = true
        var navigated = false
        browser.prepareNavigation { navigated = true }
        await close(browser)
        try await Task.sleep(for: .milliseconds(500))
        XCTAssertFalse(navigated, "Closing a preview must cancel navigation waiting for cache removal")
        browser.prepareNavigation { navigated = true }
        XCTAssertFalse(navigated)
        XCTAssertNil(browser.dialogPresenter)
    }

    func testDisableCacheRefreshesPreviouslyCachedResource() async throws {
        let server = try HTTPFixture()
        try await server.start()
        defer { server.stop() }
        let browser = try await presentBrowser(server.origin + "/page")
        let first = try await browser.webView.callAsyncJavaScript("""
            const read=()=>fetch('/cached-preview').then(response=>response.text());
            return [await read(), await read()];
            """, arguments: [:], in: nil, contentWorld: .page) as? [String]
        let cached = try XCTUnwrap(first)
        XCTAssertEqual(cached.count, 2)
        XCTAssertEqual(cached.first, cached.last)
        let refreshedPage = expectation(description: "Cache-disabled navigation finished")
        browser.onPageFinished = { refreshedPage.fulfill() }
        browser.disableCache = true
        browser.refresh()
        await fulfillment(of: [refreshedPage], timeout: 5)
        browser.onPageFinished = nil
        let refreshed = try await browser.webView.callAsyncJavaScript("return await fetch('/cached-preview').then(response=>response.text())", arguments: [:], in: nil, contentWorld: .page) as? String
        XCTAssertNotNil(refreshed)
        XCTAssertNotEqual(refreshed, cached.first)
        await close(browser)
    }

    private func presentBrowser(_ origin: String) async throws -> PreviewViewController {
        let webView = try await editorWebView()
        var responder: UIResponder? = webView
        while responder != nil, !(responder is WebViewController) { responder = responder?.next }
        let host = try XCTUnwrap(responder as? WebViewController)
        XCTAssertNil(host.presentedViewController)
        let browser = PreviewViewController(url: try XCTUnwrap(URL(string: origin)), theme: [:], console: false)
        browser.consoleEnabled = false
        let loaded = expectation(description: "Initial preview navigation finished")
        browser.onPageFinished = { loaded.fulfill() }
        await withCheckedContinuation { continuation in host.present(browser, animated: false) { continuation.resume() } }
        addTeardownBlock { @MainActor in
            if browser.presentingViewController != nil { await self.close(browser) }
        }
        await fulfillment(of: [loaded], timeout: 5)
        browser.onPageFinished = nil
        return browser
    }

    private func close(_ browser: PreviewViewController) async {
        let presenter = browser.presentingViewController
        await withCheckedContinuation { continuation in
            browser.onClose = { continuation.resume() }
            browser.close()
        }
        XCTAssertNil(browser.presentingViewController, "Preview must leave the presentation hierarchy after closing")
        XCTAssertNil(presenter?.presentedViewController, "Closing a preview must restore the editor")
    }
}

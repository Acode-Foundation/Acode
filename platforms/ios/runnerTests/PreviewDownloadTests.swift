import XCTest
import WebKit
@testable import runner

@MainActor
final class PreviewDownloadTests: BridgeTestCase {
    func testAcceptedDownloadCompletesAfterClosingPreview() async throws {
        try await interruptedDownload(closePreview: true)
    }

    func testBrokenResponseReportsFailureAndRemovesItsPartialFile() async throws {
        try await interruptedDownload(closePreview: false)
    }

    private func interruptedDownload(closePreview: Bool) async throws {
        let server = try HTTPFixture()
        try await server.start()
        defer { server.stop() }
        let app = try await editorWebView()
        var responder: UIResponder? = app
        while responder != nil, !(responder is WebViewController) { responder = responder?.next }
        let host = try XCTUnwrap(responder as? WebViewController)
        var browser: PreviewViewController? = PreviewViewController(url: try XCTUnwrap(URL(string: server.origin + "/page")), theme: [:], console: false)
        browser!.consoleEnabled = false
        await withCheckedContinuation { continuation in host.present(browser!, animated: false) { continuation.resume() } }
        addTeardownBlock { @MainActor in
            if host.presentedViewController != nil {
                await withCheckedContinuation { continuation in host.dismiss(animated: false) { continuation.resume() } }
            }
        }
        let file = AppFiles.shared.cache.appendingPathComponent(server.downloadName)
        defer { try? FileManager.default.removeItem(at: file) }
        let destination = DownloadDestination(browser: browser!, file: file)
        defer { withExtendedLifetime(destination) {} }
        let request = URLRequest(url: try XCTUnwrap(URL(string: server.origin + (closePreview ? "/stalled-download" : "/broken-download"))))
        let download = await withCheckedContinuation { continuation in
            browser!.webView.startDownload(using: request) { download in
                download.delegate = destination
                continuation.resume(returning: download)
            }
        }
        let manager = PreviewDownloadManager.shared
        addTeardownBlock { @MainActor in
            if manager.transfers[download] != nil {
                await withCheckedContinuation { continuation in
                    download.cancel { _ in
                        manager.download(download, didFailWithError: URLError(.cancelled), resumeData: nil)
                        continuation.resume()
                    }
                }
            }
        }
        if closePreview {
            for _ in 0..<100 {
                if download.progress.completedUnitCount > 0, manager.transfers[download] != nil { break }
                try await Task.sleep(for: .milliseconds(50))
            }
            XCTAssertGreaterThan(download.progress.completedUnitCount, 0)
            XCTAssertLessThan(download.progress.completedUnitCount, 16_777_216)
            XCTAssertEqual(manager.transfers[download]?.file, file)
            weak var closedBrowser = browser
            await withCheckedContinuation { continuation in
                browser!.onClose = { continuation.resume() }
                browser!.close()
            }
            XCTAssertNil(host.presentedViewController)
            browser = nil
            for _ in 0..<100 where closedBrowser != nil { try await Task.sleep(for: .milliseconds(20)) }
            XCTAssertNil(closedBrowser, "A download must not retain its closed preview")
            XCTAssertNotNil(manager.transfers[download], "Closing the preview must preserve an accepted download")
            server.completeDownloads()
            for _ in 0..<200 {
                if (host.presentedViewController as? UIAlertController)?.title == "Download complete" { break }
                try await Task.sleep(for: .milliseconds(50))
            }
            XCTAssertEqual((host.presentedViewController as? UIAlertController)?.title, "Download complete")
            var expected = Data((0..<262_144).map { UInt8($0 % 256) })
            expected.append(Data(repeating: 0, count: 16_777_216 - expected.count))
            XCTAssertEqual(try Data(contentsOf: file), expected)
        } else {
            for _ in 0..<100 {
                if browser!.activeDialog?.title == "Download failed" { break }
                try await Task.sleep(for: .milliseconds(50))
            }
            XCTAssertEqual(browser!.activeDialog?.title, "Download failed")
            XCTAssertGreaterThan(download.progress.completedUnitCount, 0)
            XCTAssertLessThan(download.progress.completedUnitCount, 16_777_216)
            XCTAssertFalse(FileManager.default.fileExists(atPath: file.path))
            await withCheckedContinuation { continuation in
                browser!.onClose = { continuation.resume() }
                browser!.close()
            }
        }
        XCTAssertNil(manager.transfers[download])
    }
}

@MainActor
private final class DownloadDestination: NSObject, WKDownloadDelegate {
    weak var browser: PreviewViewController?
    let file: URL
    init(browser: PreviewViewController, file: URL) { self.browser = browser; self.file = file }

    // Confirmation UI has separate coverage; this supplies a destination for a real WebKit transfer.
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        guard let browser else { completionHandler(nil); return }
        PreviewDownloadManager.shared.accept(download, destination: file, browser: browser)
        completionHandler(file)
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        browser?.download(download, didFailWithError: error, resumeData: resumeData)
    }
}

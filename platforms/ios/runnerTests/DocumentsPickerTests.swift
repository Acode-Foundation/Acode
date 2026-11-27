import XCTest
import WebKit
@testable import runner

@MainActor
final class DocumentsPickerTests: BridgeTestCase {
    func testImageDocumentAndFolderResultsPreserveTheirContracts() async throws {
        let webView = try await appWebView()
        let host = try controller(webView)
        let files = AppFiles.shared
        let directory = files.documents.appendingPathComponent("picker-test-" + UUID().uuidString)
        try files.manager.createDirectory(at: directory, withIntermediateDirectories: false)
        defer { try? files.manager.removeItem(at: directory) }
        let image = directory.appendingPathComponent("picked # 日本語.png")
        let bytes = UIGraphicsImageRenderer(size: CGSize(width: 4, height: 4)).pngData { context in
            UIColor.blue.setFill(); context.fill(CGRect(x: 0, y: 0, width: 4, height: 4))
        }
        try bytes.write(to: image)
        let roots = Set(files.allRoots().keys)
        let bookmarks = Set((UserDefaults.standard.dictionary(forKey: "acode.folderBookmarks") ?? [:]).keys)
        for action in ["get image", "get image", "open document file", "storage permission"] {
            try await begin(webView, action: action)
            let picker = try await presentedPicker(host)
            XCTAssertFalse(picker.allowsMultipleSelection)
            XCTAssertEqual(picker.documentPickerMode, .open)
            let selected = action == "storage permission" ? directory : image
            picker.delegate?.documentPicker?(picker, didPickDocumentsAt: [selected])
            await dismiss(picker)
            let result = try await result(webView)
            XCTAssertEqual(result["state"] as? String, "success")
            if action == "open document file" {
                let value = try XCTUnwrap(result["value"] as? [String: Any])
                XCTAssertEqual(value["filename"] as? String, image.lastPathComponent)
                XCTAssertEqual(value["uri"] as? String, "file://" + image.path)
                XCTAssertEqual(value["type"] as? String, "image/png")
                XCTAssertEqual(value["length"] as? Int, bytes.count)
                XCTAssertEqual(value["persistedUriPermission"] as? Bool, true)
            } else { XCTAssertEqual(result["value"] as? String, "file://" + selected.path) }
        }
        XCTAssertEqual(Set(files.allRoots().keys), roots)
        XCTAssertEqual(Set((UserDefaults.standard.dictionary(forKey: "acode.folderBookmarks") ?? [:]).keys), bookmarks)
    }

    func testBusyPresentationCancellationAndReloadDoNotLeavePendingPickers() async throws {
        let webView = try await appWebView()
        let host = try controller(webView)
        let modal = UIAlertController(title: "Picker fixture", message: nil, preferredStyle: .alert)
        modal.addAction(UIAlertAction(title: "OK", style: .default))
        await withCheckedContinuation { continuation in host.present(modal, animated: false) { continuation.resume() } }
        try await begin(webView, action: "get image")
        let busy = try await result(webView)
        XCTAssertEqual(busy["value"] as? String, "A document picker cannot be presented right now")
        await dismiss(modal)

        try await begin(webView, action: "get image")
        let oldPicker = try await presentedPicker(host)
        let oldDelegate = oldPicker.delegate
        try await begin(webView, action: "open document file", key: "secondPickerResult")
        let concurrent = try await result(webView, key: "secondPickerResult")
        XCTAssertEqual(concurrent["value"] as? String, "A document picker is already open")
        webView.reload()
        for _ in 0..<100 {
            if host.presentedViewController == nil { break }
            try await Task.sleep(for: .milliseconds(50))
        }
        XCTAssertNil(host.presentedViewController)
        XCTAssertNil(oldPicker.delegate)
        let reloaded = try await appWebView()
        try await begin(reloaded, action: "open document file")
        let picker = try await presentedPicker(host)
        oldDelegate?.documentPicker?(oldPicker, didPickDocumentsAt: [AppFiles.shared.documents])
        let pending = try await reloaded.evaluateJavaScript("window.pickerResult.state") as? String
        XCTAssertEqual(pending, "pending")
        picker.delegate?.documentPickerWasCancelled?(picker)
        await dismiss(picker)
        let cancelled = try await result(reloaded)
        XCTAssertEqual(cancelled["value"] as? String, "Operation cancelled")
        try await begin(reloaded, action: "get image")
        let next = try await presentedPicker(host)
        next.delegate?.documentPickerWasCancelled?(next)
        await dismiss(next)
        let nextResult = try await result(reloaded)
        XCTAssertEqual(nextResult["state"] as? String, "error")
    }

    private func controller(_ webView: WKWebView) throws -> WebViewController {
        var responder: UIResponder? = webView
        while responder != nil, !(responder is WebViewController) { responder = responder?.next }
        return try XCTUnwrap(responder as? WebViewController)
    }

    private func begin(_ webView: WKWebView, action: String, key: String = "pickerResult") async throws {
        _ = try await webView.callAsyncJavaScript("""
            window[key]={state:'pending'};
            Bridge.exec(value=>window[key]={state:'success',value},value=>window[key]={state:'error',value},'SDcard',action,[]);
            """, arguments: ["action": action, "key": key], in: nil, contentWorld: .page)
    }

    private func result(_ webView: WKWebView, key: String = "pickerResult") async throws -> [String: Any] {
        let value = try await webView.callAsyncJavaScript("""
            for(let n=0;window[key].state==='pending'&&n<100;n++)await new Promise(r=>setTimeout(r,50));
            return window[key];
            """, arguments: ["key": key], in: nil, contentWorld: .page)
        let result = try XCTUnwrap(value as? [String: Any])
        XCTAssertNotEqual(result["state"] as? String, "pending")
        return result
    }

    private func presentedPicker(_ host: UIViewController) async throws -> UIDocumentPickerViewController {
        for _ in 0..<100 {
            if let picker = host.presentedViewController as? UIDocumentPickerViewController, !picker.isBeingPresented { return picker }
            try await Task.sleep(for: .milliseconds(50))
        }
        throw NSError(domain: "AcodeTests", code: 1, userInfo: [NSLocalizedDescriptionKey: "Document picker not presented"])
    }

    private func dismiss(_ controller: UIViewController) async {
        await withCheckedContinuation { continuation in controller.dismiss(animated: false) { continuation.resume() } }
    }
}

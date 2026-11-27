import XCTest
import WebKit
@testable import runner

@MainActor
final class PreviewUploadTests: BridgeTestCase {
    func testMultipleFilesUploadThroughNativePicker() async throws {
        let server = try HTTPFixture()
        try await server.start()
        defer { server.stop() }
        let directory = AppFiles.shared.documents.appendingPathComponent("Preview upload " + UUID().uuidString.prefix(8))
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let binary = Data((0..<524293).map { UInt8($0 % 256) })
        let text = Data("café 日本語 ✓\r\nsecond line\n".utf8)
        let binaryName = "binary # 50% 日本語.bin"
        let textName = "café notes.txt"
        try binary.write(to: directory.appendingPathComponent(binaryName))
        try text.write(to: directory.appendingPathComponent(textName))
        let sources = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
        let app = try await editorWebView()
        var responder: UIResponder? = app
        while responder != nil, !(responder is WebViewController) { responder = responder?.next }
        let host = try XCTUnwrap(responder as? WebViewController)
        let browser = PreviewViewController(url: URL(string: server.origin + "/preview-transfers")!, theme: [:], console: false)
        browser.consoleEnabled = false
        let loaded = expectation(description: "Upload fixture navigation finished")
        browser.onPageFinished = { loaded.fulfill() }
        await withCheckedContinuation { continuation in host.present(browser, animated: false) { continuation.resume() } }
        addTeardownBlock { @MainActor in
            await withCheckedContinuation { continuation in
                browser.onClose = { continuation.resume() }
                browser.close()
            }
        }
        await fulfillment(of: [loaded], timeout: 5)
        browser.onPageFinished = nil
        _ = try await browser.webView.evaluateJavaScript("""
            upload.addEventListener('change',async()=>{
                try {
                    const data=new FormData();
                    data.append('message','upload ✓');
                    for(const file of upload.files)data.append('files',file,file.name);
                    const request=new Request('/echo',{method:'POST',body:data});
                    const expected=new Uint8Array(await request.clone().arrayBuffer());
                    const response=await fetch(request);
                    const received=new Uint8Array(await response.arrayBuffer());
                    window.networkUpload={status:response.status,contentType:request.headers.get('content-type'),
                        count:upload.files.length,bytes:received.length,
                        identical:received.length===expected.length&&received.every((b,i)=>b===expected[i])};
                    result.textContent=JSON.stringify(window.networkUpload);
                } catch(error){window.networkUpload={error:String(error)};result.textContent=String(error);}
            });
            """)
        _ = try await browser.webView.evaluateJavaScript("upload.accept='.bin,.txt';upload.click()")
        var picker: UIDocumentPickerViewController?
        for _ in 0..<100 {
            picker = browser.presentedViewController as? UIDocumentPickerViewController
            if picker != nil { break }
            try await Task.sleep(for: .milliseconds(50))
        }
        let selection = try XCTUnwrap(picker, "Preview file input did not present a document picker")
        XCTAssertTrue(selection.allowsMultipleSelection)
        selection.delegate?.documentPicker?(selection, didPickDocumentsAt: sources)
        if selection.presentingViewController != nil {
            await withCheckedContinuation { continuation in selection.dismiss(animated: false) { continuation.resume() } }
        }
        var result: [String: Any]?
        for _ in 0..<100 {
            result = (try? await browser.webView.evaluateJavaScript("window.networkUpload || null")) as? [String: Any]
            let filesReady = (try? await browser.webView.evaluateJavaScript("window.uploaded?.length===2")) as? Bool == true
            if result != nil && filesReady { break }
            try await Task.sleep(for: .milliseconds(100))
        }
        XCTAssertNil(result?["error"])
        XCTAssertEqual(result?["count"] as? Int, 2)
        XCTAssertEqual(result?["status"] as? Int, 200)
        XCTAssertEqual(result?["identical"] as? Bool, true)
        XCTAssertTrue((result?["contentType"] as? String ?? "").hasPrefix("multipart/form-data; boundary="))
        XCTAssertGreaterThan(result?["bytes"] as? Int ?? 0, binary.count + text.count)
        let uploaded = try await browser.webView.evaluateJavaScript("window.uploaded") as? [[String: Any]]
        XCTAssertEqual(uploaded?.count, 2)
        for (name, bytes) in [(binaryName, binary), (textName, text)] {
            let source = try XCTUnwrap(sources.first { $0.lastPathComponent == name })
            let entry = try XCTUnwrap(uploaded?.first { ($0["name"] as? String)?.utf16.elementsEqual(source.lastPathComponent.utf16) == true }, "Missing on-disk name: \(source.lastPathComponent)")
            XCTAssertEqual(entry["bytes"] as? [UInt8], Array(bytes))
        }
    }
}

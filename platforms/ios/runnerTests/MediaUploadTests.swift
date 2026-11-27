import XCTest
@testable import runner

@MainActor
final class MediaUploadTests: BridgeTestCase {
    func testFileInputOffersPhotoLibraryInsteadOfOpeningDocumentsDirectly() async throws {
        let webView = try await appWebView()
        defer {
            for window in windows() { dismissMenus(window) }
            webView.reload()
        }
        _ = try await webView.callAsyncJavaScript("""
            const input=document.createElement('input');
            input.type='file';
            input.accept='image/*';
            input.style.cssText='position:fixed;left:-10000px;width:1px;height:1px;opacity:0;pointer-events:none';
            window.mediaCancelled=false;
            input.addEventListener('cancel',()=>window.mediaCancelled=true);
            document.body.append(input);
            input.click();
            """, arguments: [:], in: nil, contentWorld: .page)
        var titles: [String] = []
        for _ in 0..<100 {
            titles = windows().flatMap { labels($0) }
            if titles.contains("Photo Library") { break }
            try await Task.sleep(for: .milliseconds(50))
        }
        XCTAssertTrue(titles.contains("Photo Library"), "Media menu missing. Visible titles: \(titles)")
        XCTAssertTrue(titles.contains("Choose File"), "File access must remain available")
        if UIImagePickerController.isSourceTypeAvailable(.camera) {
            XCTAssertTrue(titles.contains("Take Photo or Video") || titles.contains("Take Photo"), "Camera access must remain available")
        }
        for window in windows() { dismissMenus(window) }
        var cancelled = false
        for _ in 0..<100 {
            cancelled = try await webView.evaluateJavaScript("window.mediaCancelled") as? Bool == true
            if cancelled { break }
            try await Task.sleep(for: .milliseconds(50))
        }
        XCTAssertTrue(cancelled, "Dismissing the media menu must notify the plugin")
    }

    private func windows() -> [UIWindow] {
        UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows)
    }

    private func labels(_ view: UIView) -> [String] {
        let title = (view as? UILabel)?.text ?? (view as? UIButton)?.title(for: .normal) ?? view.accessibilityLabel
        return (title.map { [$0] } ?? []) + view.subviews.flatMap { labels($0) }
    }

    private func dismissMenus(_ view: UIView) {
        for interaction in view.interactions {
            (interaction as? UIContextMenuInteraction)?.dismissMenu()
        }
        for child in view.subviews { dismissMenus(child) }
    }
}

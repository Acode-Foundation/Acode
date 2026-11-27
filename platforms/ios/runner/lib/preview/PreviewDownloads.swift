import UIKit
import WebKit

extension PreviewViewController: WKDownloadDelegate {
    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        guard let presenter = dialogPresenter, presenter.presentedViewController == nil, pendingDialog == nil else { completionHandler(nil); return }
        let name = URL(fileURLWithPath: suggestedFilename).lastPathComponent
        let alert = UIAlertController(title: "Download file", message: name, preferredStyle: .alert)
        var answered = false
        let answer: (URL?) -> Void = { [weak self] destination in
            guard !answered else { return }
            answered = true; self?.pendingDialog = nil; completionHandler(destination)
        }
        pendingDialog = { answer(nil) }
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in answer(nil) })
        alert.addAction(UIAlertAction(title: "Download", style: .default) { [weak self] _ in
            guard let self else { answer(nil); return }
            do {
                let directory = AppFiles.shared.documents.appendingPathComponent("Downloads", isDirectory: true)
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                let basename = ["", ".", "..", "/"].contains(name) ? "download" : name
                var target = directory.appendingPathComponent(basename)
                if FileManager.default.fileExists(atPath: target.path) {
                    target = directory.appendingPathComponent(UUID().uuidString + "-" + basename)
                }
                PreviewDownloadManager.shared.accept(download, destination: target, browser: self)
                answer(target)
            } catch { answer(nil) }
        })
        activeDialog = alert
        presenter.present(alert, animated: true)
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        guard (error as NSError).code != NSURLErrorCancelled, let presenter = dialogPresenter, presenter.presentedViewController == nil else { return }
        let alert = UIAlertController(title: "Download failed", message: error.localizedDescription, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        activeDialog = alert
        presenter.present(alert, animated: true)
    }
}

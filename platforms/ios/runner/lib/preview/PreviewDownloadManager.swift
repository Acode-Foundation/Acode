import UIKit
import WebKit

@MainActor
final class PreviewDownloadManager: NSObject, WKDownloadDelegate {
    static let shared = PreviewDownloadManager()
    private(set) var transfers: [WKDownload: Transfer] = [:]

    func accept(_ download: WKDownload, destination: URL, browser: PreviewViewController) {
        transfers[download] = Transfer(file: destination, browser: browser)
        download.delegate = self
    }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        completionHandler(transfers[download]?.file)
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let transfer = transfers.removeValue(forKey: download) else { return }
        show("Download complete", message: "Saved to Acode/Downloads/" + transfer.file.lastPathComponent, transfer: transfer)
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        guard let transfer = transfers.removeValue(forKey: download) else { return }
        try? FileManager.default.removeItem(at: transfer.file)
        guard (error as NSError).code != NSURLErrorCancelled else { return }
        show("Download failed", message: error.localizedDescription, transfer: transfer)
    }

    private func show(_ title: String, message: String, transfer: Transfer) {
        DispatchQueue.main.async {
            guard let presenter = transfer.browser?.dialogPresenter ?? transfer.presenter,
                  presenter.isViewLoaded, presenter.view.window != nil else { return }
            // A finished transfer can arrive while its confirmation or preview is dismissing.
            if let transition = presenter.transitionCoordinator ?? presenter.presentedViewController?.transitionCoordinator,
               transition.animate(alongsideTransition: nil, completion: { _ in self.show(title, message: message, transfer: transfer) }) { return }
            guard presenter.presentedViewController == nil, !presenter.isBeingDismissed else { return }
            let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "OK", style: .default))
            if transfer.browser?.isClosed == false { transfer.browser?.activeDialog = alert }
            presenter.present(alert, animated: true)
        }
    }

    @MainActor final class Transfer {
        let file: URL
        weak var browser: PreviewViewController?
        weak var presenter: UIViewController?

        init(file: URL, browser: PreviewViewController) {
            self.file = file
            self.browser = browser
            let current = browser.dialogPresenter
            presenter = current?.presentingViewController ?? current
        }
    }
}

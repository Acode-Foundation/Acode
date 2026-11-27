import UIKit

final class BrowserService: BaseService {
    private weak var browser: PreviewViewController?

    override func reset() {
        DispatchQueue.main.async { self.browser?.close() }
    }

    override func exec(action: String, args: [Any], callback: Callback) {
        guard ["open", "in-app-browser"].contains(action), let value = args[safe: 0] as? String,
              let url = URL(string: value), ["http", "https"].contains(url.scheme?.lowercased() ?? ""), url.host != nil else {
            callback.error("Preview requires an HTTP or HTTPS URL"); return
        }
        DispatchQueue.main.async {
            guard let presenter = self.viewController, presenter.presentedViewController == nil else {
                callback.error("A browser cannot be presented right now"); return
            }
            let browser = PreviewViewController(url: url, theme: args[safe: 1] as? [String: Any] ?? [:], console: action == "open" && args[safe: 2] as? Bool == true)
            if action == "in-app-browser" {
                browser.title = args[safe: 1] as? String
                browser.showTools = args[safe: 2] as? Bool ?? true
                browser.disableCache = args[safe: 3] as? Bool ?? false
                browser.onExternal = { callback.success("onOpenExternalBrowser:" + $0.absoluteString, keep: true) }
                browser.onClose = { callback.release() }
            }
            self.browser = browser
            presenter.present(browser, animated: true) { if action == "open" { callback.success() } }
        }
    }
}

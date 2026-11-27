import SafariServices

final class SafariService: BaseService, SFSafariViewControllerDelegate {
    private weak var browser: SFSafariViewController?
    private var openCallback: Callback?
    private var lifecycleCallback: Callback?
    private var authTabId: String?

    override func reset() {
        DispatchQueue.main.async {
            self.browser?.dismiss(animated: false)
            self.browser = nil
            self.openCallback?.error("Browser presentation was cancelled")
            self.openCallback = nil
            self.lifecycleCallback?.release()
            self.lifecycleCallback = nil
            self.authTabId = nil
        }
    }

    override func exec(action: String, args: [Any], callback: Callback) {
        if action == "close" {
            DispatchQueue.main.async {
                guard let id = args[safe: 0] as? String, id == self.authTabId, let browser = self.browser else {
                    callback.success(); return
                }
                browser.dismiss(animated: true) {
                    self.safariViewControllerDidFinish(browser)
                    callback.success()
                }
            }
            return
        }
        guard let value = args[safe: 0] as? String, let inputURL = URL(string: value), let scheme = inputURL.scheme?.lowercased() else {
            callback.error("Invalid browser URL"); return
        }
        let url = Self.websiteURL(inputURL)
        if action == "external" {
            guard !["javascript", "data", "file", "acode", "about"].contains(scheme) else { callback.error("Unsupported external URL"); return }
            DispatchQueue.main.async {
                UIApplication.shared.open(url) { opened in
                    if opened { callback.success() }
                    else { callback.error("No app can open this URL") }
                }
            }
            return
        }
        guard action == "open", ["http", "https"].contains(scheme), url.host != nil else {
            callback.error("Custom tabs require an HTTP or HTTPS URL"); return
        }
        let options = args[safe: 1] as? [String: Any] ?? [:]
        DispatchQueue.main.async {
            guard let presenter = self.viewController, presenter.presentedViewController == nil else {
                callback.error("A browser cannot be presented right now"); return
            }
            let configuration = SFSafariViewController.Configuration()
            configuration.barCollapsingEnabled = false
            let browser = SFSafariViewController(url: url, configuration: configuration)
            browser.delegate = self
            browser.modalPresentationStyle = .fullScreen
            browser.dismissButtonStyle = .close
            if #unavailable(iOS 26), let color = options["toolbarColor"] as? String { browser.preferredBarTintColor = UIColor(hexString: color) }
            self.browser = browser
            self.openCallback = callback
            self.authTabId = options["authTabId"] as? String
            let reportLifecycle = options["reportLifecycle"] as? Bool == true
            presenter.present(browser, animated: true) {
                guard self.browser === browser else { return }
                self.openCallback = nil
                if reportLifecycle {
                    self.lifecycleCallback = callback
                    callback.success(["type": "opened"], keep: true)
                }
                else { callback.success() }
            }
        }
    }

    func safariViewController(_ controller: SFSafariViewController, activityItemsFor url: URL, title: String?) -> [UIActivity] {
        BrowserActivity.available(for: url, canOpen: UIApplication.shared.canOpenURL)
    }

    func safariViewControllerDidFinish(_ controller: SFSafariViewController) {
        guard browser === controller else { return }
        browser = nil
        authTabId = nil
        openCallback?.error("Browser closed before presentation completed")
        openCallback = nil
        lifecycleCallback?.success(["type": "closed"])
        lifecycleCallback = nil
    }

    static func websiteURL(_ url: URL) -> URL {
        guard url.scheme?.lowercased() == "https",
              ["acode.app", "dev.acode.app"].contains(url.host?.lowercased() ?? ""),
              url.port == nil || url.port == 443,
              url.user == nil, url.password == nil,
              var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return url }
        var query = components.percentEncodedQuery?.components(separatedBy: "&") ?? []
        query.removeAll { $0.components(separatedBy: "=").first?.removingPercentEncoding == "src" }
        query.append("src=ios")
        components.percentEncodedQuery = query.joined(separator: "&")
        return components.url ?? url
    }
}

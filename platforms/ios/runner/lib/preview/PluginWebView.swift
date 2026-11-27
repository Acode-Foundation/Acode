import WebKit

@MainActor
final class PluginWebView: NSObject, WKScriptMessageHandler {
    let id = "wv_" + UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(12)
    let controller: PreviewViewController
    let fullscreen: Bool
    private let allowNavigation: Bool
    private var ready: Bool
    private var requestedURL: URL?
    private var pendingHTML: String?
    private var loadedHTML: String?
    private var pendingURL: URL?
    var emit: (([String: Any]) -> Void)?

    init(options: [String: Any]) {
        fullscreen = options["mode"] as? String == "fullscreen"
        ready = !fullscreen
        allowNavigation = options["allowNavigation"] as? Bool ?? true
        controller = PreviewViewController(url: URL(string: "about:blank")!, theme: [:], console: true)
        super.init()
        controller.consoleEnabled = false
        controller.title = options["title"] as? String
        controller.allowsDownloads = options["allowDownloads"] as? Bool ?? false
        controller.externalSchemesAllowed = false
        controller.navigationPolicy = { [weak self] action in self?.allow(action) ?? false }
        controller.onPageFinished = { [weak self] in
            guard let self else { return }
            self.event("pageFinished", data: ["url": self.controller.webView.url?.absoluteString ?? "", "title": self.controller.webView.title ?? ""])
        }
        controller.onTitleChanged = { [weak self] title in self?.event("titleChanged", data: ["title": title]) }
        let content = controller.webView.configuration.userContentController
        WebShadowCaret.install(on: content)
        content.add(WeakScriptMessageHandler(self), name: "webviewMessage")
        content.addUserScript(WKUserScript(source: Self.messagingScript, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        if ready { controller.loadViewIfNeeded() }
    }

    func show(from presenter: UIViewController, callback: Callback? = nil) {
        guard fullscreen else { callback?.error("Hidden WebViews cannot be shown; use mode fullscreen"); return }
        if controller.presentingViewController != nil { callback?.success(); return }
        guard presenter.presentedViewController == nil else { callback?.error("A WebView cannot be presented right now"); return }
        ready = true
        controller.loadViewIfNeeded()
        if let url = pendingURL { pendingURL = nil; load(url) }
        else if let html = pendingHTML { pendingHTML = nil; loadHTML(html) }
        presenter.present(controller, animated: true) { callback?.success() }
    }

    func hide(callback: Callback) {
        guard controller.presentingViewController != nil else { callback.success(); return }
        controller.dismiss(animated: true) { callback.success() }
    }

    func load(_ url: URL) {
        guard ready else { pendingURL = url; pendingHTML = nil; return }
        loadedHTML = nil
        requestedURL = url
        controller.load(url)
    }

    func loadHTML(_ html: String) {
        guard ready else { pendingHTML = html; pendingURL = nil; return }
        loadedHTML = html
        requestedURL = URL(string: "about:blank")!
        controller.webView.loadHTMLString(html, baseURL: nil)
    }

    func evaluate(_ code: String, callback: Callback) {
        guard ready else { callback.error("WebView is not ready"); return }
        controller.webView.evaluateJavaScript(code) { value, error in
            if let error { callback.error((error as NSError).userInfo["WKJavaScriptExceptionMessage"] as? String ?? error.localizedDescription) }
            else if value == nil || value is NSNull { callback.success() }
            else if let value = value as? String { callback.success(value) }
            else if let value, let data = try? JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed]), let text = String(data: data, encoding: .utf8) { callback.success(text) }
            else { callback.success() }
        }
    }

    func post(_ message: String, callback: Callback) {
        guard ready else { callback.error("WebView is not ready"); return }
        controller.webView.callAsyncJavaScript("let value;try{value=JSON.parse(message)}catch{value=message}window.webview?._dispatch(value)", arguments: ["message": message], in: nil, in: .page) { result in
            switch result {
            case .success: callback.success()
            case .failure(let error): callback.error((error as NSError).userInfo["WKJavaScriptExceptionMessage"] as? String ?? error.localizedDescription)
            }
        }
    }

    func reload(callback: Callback) {
        guard ready else { callback.error("WebView is not ready"); return }
        if let html = loadedHTML, controller.webView.url?.absoluteString == "about:blank" {
            loadHTML(html); callback.success(); return
        }
        requestedURL = controller.webView.url
        controller.webView.reload()
        callback.success()
    }

    func destroy(completion: @escaping () -> Void = {}) {
        controller.onClose = completion
        controller.close()
        controller.webView.configuration.userContentController.removeScriptMessageHandler(forName: "webviewMessage")
        emit = nil
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, let text = message.body as? String else { return }
        emit?(["id": id, "message": text])
    }

    func event(_ name: String, data: [String: Any] = [:]) { emit?(["id": id, "event": name, "data": data]) }

    private func allow(_ action: WKNavigationAction) -> Bool {
        guard let url = action.request.url else { return false }
        if action.targetFrame?.isMainFrame == true, let expected = requestedURL, expected == url {
            requestedURL = nil
            return true
        }
        return allowNavigation && ["http", "https"].contains(url.scheme?.lowercased() ?? "")
    }

    private static let messagingScript = """
        (()=>{
            if(window.webview?.__acodeBridge)return;
            let callbacks=[];
            window.webview={
                __acodeBridge:true,
                onMessage:callback=>{if(typeof callback==='function')callbacks.push(callback)},
                offMessage:callback=>{callbacks=callbacks.filter(item=>item!==callback)},
                postMessage:message=>window.webkit.messageHandlers.webviewMessage.postMessage(typeof message==='string'?message:JSON.stringify(message)),
                _dispatch:message=>callbacks.slice().forEach(callback=>{try{callback(message)}catch(error){console.error(error)}})
            };
        })();
        """
}

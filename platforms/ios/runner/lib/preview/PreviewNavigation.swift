import UIKit
import WebKit

extension PreviewViewController: WKNavigationDelegate, WKUIDelegate, UITextFieldDelegate {
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard !isClosed, let url = action.request.url else { decisionHandler(.cancel); return }
        if navigationPolicy?(action) == false { decisionHandler(.cancel); return }
        let scheme = url.scheme?.lowercased() ?? ""
        if ["http", "https", "about", "blob", "data"].contains(scheme) {
            decisionHandler(action.shouldPerformDownload ? (allowsDownloads ? .download : .cancel) : .allow)
        } else {
            decisionHandler(.cancel)
            if externalSchemesAllowed, action.navigationType == .linkActivated, !["file", "acode", "javascript"].contains(scheme) { UIApplication.shared.open(url) }
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        guard !isClosed else { decisionHandler(.cancel); return }
        let disposition = (response.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition") ?? ""
        decisionHandler(!response.canShowMIMEType || disposition.lowercased().hasPrefix("attachment") ? (allowsDownloads ? .download : .cancel) : .allow)
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        progress.startAnimating()
        consoleAvailable = false
        updateMenu()
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        updateAddress()
        progress.stopAnimating()
        if consoleEnabled { prepareConsole() }
        onPageFinished?()
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { navigationFailed(error) }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { navigationFailed(error) }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if action.targetFrame == nil, navigationPolicy?(action) != false, let url = action.request.url { load(url) }
        return nil
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        showDialog(message, defaultText: nil, confirm: false) { _ in completionHandler() }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        showDialog(message, defaultText: nil, confirm: true) { completionHandler($0 != nil) }
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        showDialog(prompt, defaultText: defaultText ?? "", confirm: true, completion: completionHandler)
    }

    func textFieldDidBeginEditing(_ textField: UITextField) {
        textField.text = webView.url?.absoluteString ?? initialURL.absoluteString
    }

    func textFieldDidEndEditing(_ textField: UITextField) { updateAddress() }

    func textFieldShouldReturn(_ textField: UITextField) -> Bool {
        let value = textField.text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if let url = URL(string: value.contains("://") ? value : "http://" + value) { load(url) }
        textField.resignFirstResponder()
        return true
    }

    private func showDialog(_ message: String, defaultText: String?, confirm: Bool, completion: @escaping (String?) -> Void) {
        guard let presenter = dialogPresenter, presenter.presentedViewController == nil, pendingDialog == nil else { completion(nil); return }
        let alert = UIAlertController(title: webView.url?.host, message: message, preferredStyle: .alert)
        if let defaultText { alert.addTextField { $0.text = defaultText } }
        var answered = false
        let answer: (String?) -> Void = { [weak self] value in
            guard !answered else { return }
            answered = true; self?.pendingDialog = nil; completion(value)
        }
        pendingDialog = { answer(nil) }
        if confirm { alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in answer(nil) }) }
        alert.addAction(UIAlertAction(title: "OK", style: .default) { [weak alert] _ in answer(alert?.textFields?.first?.text ?? "") })
        activeDialog = alert
        presenter.present(alert, animated: true)
    }

    private func navigationFailed(_ error: Error) {
        progress.stopAnimating()
        guard (error as NSError).code != NSURLErrorCancelled, presentedViewController == nil else { return }
        showDialog(error.localizedDescription, defaultText: nil, confirm: false) { _ in }
    }

    private func prepareConsole() {
        let url = webView.url
        let inspect = "Boolean(sessionStorage.getItem('__console_available') || document.querySelector('c-toggler') || window.eruda)"
        webView.evaluateJavaScript(inspect) { [weak self] result, _ in
            guard let self, self.webView.url == url else { return }
            if result as? Bool == true { self.consoleReady(); return }
            guard !self.consoleOnly else { return }
            let file = AppFiles.shared.data.appendingPathComponent("eruda.js")
            DispatchQueue.global(qos: .userInitiated).async {
                let source = try? String(contentsOf: file, encoding: .utf8)
                DispatchQueue.main.async {
                    guard self.webView.url == url else { return }
                    if let source { self.installConsole(source) }
                }
            }
        }
    }

    private func installConsole(_ source: String) {
        webView.evaluateJavaScript(source + "\n;if(window.eruda){eruda.init({theme:'dark'});eruda._shadowRoot.querySelector('.eruda-entry-btn').style.display='none';sessionStorage.setItem('__console_available',true);document.addEventListener('showconsole',()=>eruda.show());document.addEventListener('hideconsole',()=>eruda.hide());}") { [weak self] _, error in
            if error == nil { self?.consoleReady() }
        }
    }

    private func consoleReady() {
        consoleAvailable = true
        setConsoleVisible(consoleVisible)
        updateMenu()
    }
}

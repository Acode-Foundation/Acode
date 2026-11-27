import WebKit

final class Callback {
    let id: Int
    private weak var webView: WKWebView?
    private let isValid: () -> Bool

    init(id: Int, webView: WKWebView?, isValid: @escaping () -> Bool = { true }) {
        self.id = id
        self.webView = webView
        self.isValid = isValid
    }

    func success(_ value: Any? = nil, keep: Bool = false) {
        send(success: value, error: nil, keep: keep, isBinary: false, length: 0)
    }

    func successBinary(_ data: Data, keep: Bool = false) {
        success(["kind": "arrayBuffer", "data": data.base64EncodedString()], keep: keep)
    }

    func error(_ message: Any, keep: Bool = false) {
        send(success: nil, error: message, keep: keep, isBinary: false, length: 0)
    }

    func release() {
        send(success: nil, error: nil, keep: false, isBinary: false, length: 0, status: 0)
    }

    private func send(success: Any?, error: Any?, keep: Bool, isBinary: Bool, length: Int, status: Int? = nil) {
        var payload: [String: Any] = [
            "id":       id,
            "keep":     keep,
            "isBinary": isBinary,
            "length":   length,
        ]
        payload["status"] = status ?? (error == nil ? 1 : 9)
        if let error = error {
            payload["error"] = error
        } else {
            payload["success"] = success ?? NSNull()
        }

        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else { return }

        let js = "window.iOS&&window.iOS.callback(\(json))"
        DispatchQueue.main.async { [weak webView, isValid] in
            guard isValid() else { return }
            webView?.evaluateJavaScript(js, completionHandler: nil)
        }
    }
}

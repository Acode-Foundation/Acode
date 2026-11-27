import Foundation
import WebKit

final class EmbeddedProxyServer {
    static let shared = EmbeddedProxyServer()
    private let queue = DispatchQueue(label: "acode.embeddedProxy", qos: .userInitiated)
    private var listeners: [Int: LocalHTTPServer] = [:]
    private var pending: [String: LocalHTTPConnection] = [:]

    func startServer(port: Int, webView: WKWebView) -> Bool {
        queue.sync { () -> Bool in
            if listeners[port] != nil { return true }
            guard (1...65535).contains(port), let server = try? LocalHTTPServer(port: port, loopback: true, queue: queue) else { return false }
            listeners[port] = server
            server.onRequest = { [weak self, weak webView] request, client in
                guard let self else { client.cancel(); return }
                self.pending[client.id] = client
                let cleanup = client.onClose
                client.onClose = { [weak self, weak client] in
                    cleanup?()
                    if let client { self?.pending.removeValue(forKey: client.id) }
                }
                let headers = String(data: (try? JSONSerialization.data(withJSONObject: request.headers)) ?? Data(), encoding: .utf8) ?? "{}"
                DispatchQueue.main.async {
                    guard let webView else { self.sendResponseError(requestId: client.id, errorMessage: "WebView closed"); return }
                    webView.callAsyncJavaScript("window.__acodeProxy.httpRequest(id,method,url,headers,body)",
                        arguments: ["id": client.id, "method": request.method, "url": request.target,
                                    "headers": headers, "body": String(decoding: request.body, as: UTF8.self)],
                        in: nil, in: .page) { result in
                        if case .failure = result { self.sendResponseError(requestId: client.id, errorMessage: "Preview request handler unavailable") }
                    }
                }
            }
            server.start { [weak self, weak server] result in
                if case .failure = result, self?.listeners[port] === server { self?.listeners.removeValue(forKey: port) }
            }
            return true
        }
    }

    func stopServer(port: Int) {
        queue.sync { listeners.removeValue(forKey: port)?.stop() }
    }

    func stopAll() {
        queue.sync {
            let servers = Array(listeners.values)
            listeners.removeAll()
            for server in servers { server.stop() }
        }
    }

    func hasServer(port: Int) -> Bool {
        queue.sync { listeners[port] != nil }
    }

    func cancelAllPending() {
        queue.sync {
            let clients = Array(pending.values)
            pending.removeAll()
            for client in clients { client.cancel() }
        }
    }

    func sendResponseStart(requestId: String, status: Int, statusText: String, headersJson: String) {
        queue.async { [weak self] in
            guard let client = self?.pending[requestId], (200...599).contains(status) else { return }
            let headers = (try? JSONSerialization.jsonObject(with: Data(headersJson.utf8))) as? [String: String] ?? [:]
            let length = headers.first { $0.key.lowercased() == "content-length" }.flatMap { UInt64($0.value) }
            client.startResponse(status: status, headers: headers, length: length)
        }
    }

    func sendResponseData(requestId: String, chunkBase64: String, index: Int) {
        queue.async { [weak self] in
            guard let client = self?.pending[requestId], let data = Data(base64Encoded: chunkBase64) else { return }
            client.send(data)
        }
    }

    func sendResponseEnd(requestId: String) {
        queue.async { [weak self] in self?.pending[requestId]?.end() }
    }

    func sendResponseError(requestId: String, errorMessage: String) {
        queue.async { [weak self] in
            self?.pending[requestId]?.respond(status: 502, headers: ["Content-Type": "text/plain"], body: Data(errorMessage.utf8))
        }
    }
}

import Foundation

@MainActor
final class IncomingLinks {
    static let shared = IncomingLinks()
    private var pending: [[String: Any]] = []
    private var listener: Callback?
    private var pendingAuth: URL?
    var authenticationHandler: ((URL) -> Void)? {
        didSet {
            if let pendingAuth, let authenticationHandler {
                self.pendingAuth = nil
                authenticationHandler(pendingAuth)
            }
        }
    }

    func receive(_ url: URL) {
        if url.scheme == "acode", url.host == "auth", url.path == "/callback" {
            if let authenticationHandler { authenticationHandler(url) }
            else { pendingAuth = url }
            return
        }
        var intent: [String: Any] = ["action": "android.intent.action.VIEW", "data": url.absoluteString]
        if url.isFileURL {
            let files = AppFiles.shared
            do {
                if (try? files.resolve(url.absoluteString)) == nil {
                    try files.remember(url)
                }
                intent["data"] = "file://" + url.path
                intent["fileUri"] = intent["data"]
                intent["uris"] = [intent["data"]!]
            } catch { intent["error"] = error.localizedDescription }
        }
        if let listener { listener.success(intent, keep: true) }
        else { pending.append(intent) }
        NotificationCenter.default.post(name: .acodeDeepLink, object: url)
    }

    func listen(_ callback: Callback) { listener?.release(); listener = callback }

    func current(_ callback: Callback) {
        callback.success(pending.isEmpty ? [:] : pending.removeFirst())
        if let listener {
            for intent in pending { listener.success(intent, keep: true) }
            pending.removeAll()
        }
    }

    func reset() { listener?.release(); listener = nil }
}

final class EmbeddedProxyService: BaseService {

    private let server = EmbeddedProxyServer.shared

    override func exec(action: String, args: [Any], callback: Callback) {
        switch action {
        case "responseStart":
            handleResponseStart(args: args, callback: callback)
        case "responseData":
            handleResponseData(args: args, callback: callback)
        case "responseEnd":
            handleResponseEnd(args: args, callback: callback)
        case "responseError":
            handleResponseError(args: args, callback: callback)
        default:
            callback.error("Unknown action: \(action)")
        }
    }

    override func reset() { cleanupAll() }

    // MARK: - Response Handlers

    private func handleResponseStart(args: [Any], callback: Callback) {
        guard let requestId = args[safe: 0] as? String,
              let status = args[safe: 1] as? Int,
              let statusText = args[safe: 2] as? String,
              let headersJson = args[safe: 3] as? String else {
            callback.error("Invalid responseStart args")
            return
        }

        server.sendResponseStart(requestId: requestId, status: status, statusText: statusText, headersJson: headersJson)
        callback.success()
    }

    private func handleResponseData(args: [Any], callback: Callback) {
        guard let requestId = args[safe: 0] as? String,
              let chunk = args[safe: 1] as? String,
              let index = args[safe: 2] as? Int else {
            callback.error("Invalid responseData args")
            return
        }

        server.sendResponseData(requestId: requestId, chunkBase64: chunk, index: index)
        callback.success()
    }

    private func handleResponseEnd(args: [Any], callback: Callback) {
        guard let requestId = args[safe: 0] as? String else {
            callback.error("Invalid responseEnd args")
            return
        }

        server.sendResponseEnd(requestId: requestId)
        callback.success()
    }

    private func handleResponseError(args: [Any], callback: Callback) {
        guard let requestId = args[safe: 0] as? String else {
            callback.error("Invalid responseError args")
            return
        }
        let errorMessage = args[safe: 1] as? String ?? "Unknown error"
        server.sendResponseError(requestId: requestId, errorMessage: errorMessage)
        callback.success()
    }

    // MARK: - Server Lifecycle

    func ensureServer(port: Int) -> Bool {
        guard let webView = bridge?.webView else { return false }
        return server.startServer(port: port, webView: webView)
    }

    func cleanupServer(port: Int) {
        server.stopServer(port: port)
    }

    func cleanupAll() {
        server.cancelAllPending()
        server.stopAll()
    }

    func hasServer(port: Int) -> Bool {
        return server.hasServer(port: port)
    }
}

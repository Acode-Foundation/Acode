import Foundation

final class HTTPStreamService {
    private let queue = DispatchQueue(label: "app.acode.http.streams")
    private var streams: [String: HTTPStream] = [:]

    func reset() {
        queue.async {
            self.streams.values.forEach { $0.cancel() }
            self.streams.removeAll()
        }
    }

    func exec(action: String, args: [Any], callback: Callback) {
        queue.async { [self] in
            let id = args[safe: 0] as? String ?? ""
            do {
                switch action {
                case "http-stream-start":
                    guard !id.isEmpty, self.streams[id] == nil else { throw HTTPFailure(status: -1, message: "Invalid stream ID") }
                    let stream = try HTTPStream(args: args, callback: callback) { [weak self] finished in
                        self?.queue.async {
                            if self?.streams[id] === finished { self?.streams.removeValue(forKey: id) }
                        }
                    }
                    self.streams[id] = stream
                    stream.transport.start()
                case "http-stream-cancel": self.streams[id]?.cancel(); callback.success()
                case "http-stream-ack": self.streams[id]?.acknowledge(args[safe: 1] as? Int ?? 0); callback.success()
                default: callback.error("Unknown HTTP stream action")
                }
            } catch { callback.error(error.localizedDescription) }
        }
    }
}

private final class HTTPStream {
    let transport: HTTPTransport
    private let callback: Callback
    private let chunkSize: Int
    private let onFinish: (HTTPStream) -> Void
    private var pending = Data()
    private var outstanding = 0
    private var complete = false
    private var finished = false

    init(args: [Any], callback: Callback, onFinish: @escaping (HTTPStream) -> Void) throws {
        guard let address = args[safe: 1] as? String, let url = URL(string: address),
              ["http", "https"].contains(url.scheme?.lowercased() ?? ""), url.host != nil else { throw HTTPFailure(status: -5, message: "Expected an HTTP or HTTPS URL") }
        let options = args[safe: 2] as? [String: Any] ?? [:]
        var request = URLRequest(url: url)
        request.httpMethod = (options["method"] as? String ?? "GET").uppercased()
        request.allHTTPHeaderFields = options["headers"] as? [String: String] ?? [:]
        request.httpShouldHandleCookies = false
        if let body = options["body"] as? String {
            if options["bodyIsBase64"] as? Bool == true {
                guard let data = Data(base64Encoded: body) else { throw HTTPFailure(status: -1, message: "Invalid stream body") }
                request.httpBody = data
            } else { request.httpBody = Data(body.utf8) }
        }
        chunkSize = max(1024, min(65536, options["chunkSize"] as? Int ?? 32768))
        self.callback = callback
        self.onFinish = onFinish
        transport = HTTPTransport(request: request, followRedirects: options["followRedirects"] as? Bool ?? true,
                                  connectTimeout: (options["connectTimeout"] as? Double ?? 30000) / 1000,
                                  readTimeout: (options["readTimeout"] as? Double ?? 0) / 1000)
        transport.onResponse = { response in
            callback.success(["type": "headers", "status": response.statusCode, "statusText": HTTPURLResponse.localizedString(forStatusCode: response.statusCode),
                              "url": response.url?.absoluteString ?? address,
                              "headers": response.allHeaderFields.map { [String(describing: $0.key), String(describing: $0.value)] }], keep: true)
        }
        transport.onData = { [weak self] data in self?.pending.append(data); self?.drain() }
        transport.onComplete = { [weak self] error in
            guard let self, !self.finished else { return }
            if let error { self.finish(error) }
            else { self.complete = true; self.drain() }
        }
    }

    func acknowledge(_ bytes: Int) {
        transport.queue.async {
            guard bytes > 0, !self.finished else { return }
            self.outstanding -= min(bytes, self.outstanding)
            self.drain()
        }
    }

    func cancel() {
        transport.queue.async {
            self.finish(URLError(.cancelled))
            self.transport.cancel()
        }
    }

    private func drain() {
        guard !finished else { return }
        while !pending.isEmpty, outstanding < 65536 {
            let count = min(chunkSize, min(pending.count, 65536 - outstanding))
            let chunk = pending.prefix(count)
            callback.success(["type": "data", "chunk": chunk.base64EncodedString(), "b64": true], keep: true)
            outstanding += count
            pending.removeFirst(count)
        }
        transport.setPaused(outstanding >= 65536)
        if complete, pending.isEmpty { finish(nil) }
    }

    private func finish(_ error: Error?) {
        guard !finished else { return }
        finished = true
        pending.removeAll()
        if let error { callback.success(["type": "error", "message": error.localizedDescription]) }
        else { callback.success(["type": "complete"]) }
        onFinish(self)
    }
}

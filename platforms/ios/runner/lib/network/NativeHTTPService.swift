import Foundation

final class NativeHTTPService: BaseService {
    private let queue = DispatchQueue(label: "app.acode.http.requests")
    private var requests: [Int: HTTPTransport] = [:]
    private var trust = HTTPTrust()

    override func reset() {
        queue.async {
            self.requests.values.forEach { $0.cancel() }
            self.requests.removeAll()
            self.trust = HTTPTrust()
        }
    }

    override func exec(action: String, args: [Any], callback: Callback) {
        queue.async { [self] in
            do {
                switch action {
                case "setServerTrustMode":
                    try self.trust.configureServer(args[safe: 0] as? String ?? "default")
                    callback.success()
                case "setClientAuthMode": try self.trust.configureClient(args); callback.success()
                case "abort":
                    let request = self.requests[args[safe: 0] as? Int ?? -1]
                    request?.cancel()
                    callback.success(["aborted": request != nil])
                default:
                    let spec = try HTTPRequest(action: action, args: args)
                    guard self.requests[spec.id] == nil else { throw HTTPFailure(status: -1, message: "Duplicate request ID") }
                    let result = HTTPResult(spec: spec, callback: callback)
                    let transport = HTTPTransport(request: spec.request, followRedirects: spec.followRedirects, connectTimeout: spec.connectTimeout, readTimeout: spec.readTimeout, trust: self.trust)
                    transport.onResponse = { try result.receive($0) }
                    transport.onData = { try result.receive($0) }
                    transport.onComplete = { [weak self, weak transport] error in
                        result.finish(error)
                        guard let transport else { return }
                        self?.queue.async {
                            if self?.requests[spec.id] === transport { self?.requests.removeValue(forKey: spec.id) }
                        }
                    }
                    self.requests[spec.id] = transport
                    transport.start()
                }
            } catch { callback.error(["status": HTTPFailure.status(error), "url": args[safe: 0] as? String ?? "", "headers": [:], "error": error.localizedDescription]) }
        }
    }
}

private final class HTTPResult {
    let spec: HTTPRequest
    let callback: Callback
    var response: HTTPURLResponse?
    var data = Data()
    var output: FileHandle?
    var temporary: URL?

    init(spec: HTTPRequest, callback: Callback) { self.spec = spec; self.callback = callback }

    func receive(_ response: HTTPURLResponse) throws {
        self.response = response
        if let destination = spec.destination, (200..<300).contains(response.statusCode) {
            let temporary = destination.deletingLastPathComponent().appendingPathComponent(".acode-download-" + UUID().uuidString)
            try Data().write(to: temporary, options: .withoutOverwriting)
            self.temporary = temporary
            output = try FileHandle(forWritingTo: temporary)
        }
    }

    func receive(_ bytes: Data) throws {
        if let output { try output.write(contentsOf: bytes) }
        else { data.append(bytes) }
    }

    func finish(_ failure: Error?) {
        var result: [String: Any] = ["url": response?.url?.absoluteString ?? spec.request.url!.absoluteString, "status": response?.statusCode ?? -1, "headers": headers()]
        defer { if let temporary { try? FileManager.default.removeItem(at: temporary) } }
        do {
            try output?.close(); output = nil
            if let failure { throw failure }
            guard let response else { throw HTTPFailure(status: -1, message: "Missing HTTP response") }
            if !(200..<300).contains(response.statusCode) {
                result["error"] = text(); callback.error(result); return
            }
            if let destination = spec.destination, let temporary {
                let files = AppFiles.shared
                try files.coordinate(destination, writing: true) { target in
                    if files.manager.fileExists(atPath: target.path) { _ = try files.manager.replaceItemAt(target, withItemAt: temporary) }
                    else { try files.manager.moveItem(at: temporary, to: target) }
                }
                result["file"] = try files.entry(destination)
            } else { result["data"] = ["arraybuffer", "blob"].contains(spec.responseType) ? data.base64EncodedString() : text() }
            callback.success(result)
        } catch {
            result["status"] = HTTPFailure.status(error)
            result["error"] = error.localizedDescription
            callback.error(result)
        }
    }

    private func headers() -> [String: String] {
        Dictionary((response?.allHeaderFields ?? [:]).map { (String(describing: $0.key).lowercased(), String(describing: $0.value)) }, uniquingKeysWith: { first, second in first + ", " + second })
    }

    private func text() -> String {
        let encoding = try? FileContents.encoding(response?.textEncodingName ?? "UTF-8")
        return String(data: data, encoding: encoding ?? .utf8) ?? String(decoding: data, as: UTF8.self)
    }
}

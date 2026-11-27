import Foundation

final class WebSocketService: BaseService {
    private let queue = DispatchQueue(label: "app.acode.websockets")
    private var sockets: [String: NativeSocket] = [:]

    override func reset() {
        queue.async {
            self.sockets.values.forEach { $0.stop() }
            self.sockets.removeAll()
        }
    }

    override func exec(action: String, args: [Any], callback: Callback) {
        queue.async { [self] in
            do {
                if action == "connect" {
                    let id = UUID().uuidString
                    let socket = try NativeSocket(args: args, queue: self.queue) { [weak self] in self?.sockets.removeValue(forKey: id) }
                    self.sockets[id] = socket
                    callback.success(id)
                    socket.task.resume()
                    return
                }
                if action == "listClients" { callback.success(Array(self.sockets.keys)); return }
                guard let id = args[safe: 0] as? String, let socket = self.sockets[id] else { throw HTTPFailure(status: -1, message: "Invalid socket ID") }
                switch action {
                case "registerListener": socket.listen(callback)
                case "setBinaryType": socket.binaryType = args[safe: 1] as? String ?? ""; callback.success()
                case "send":
                    let text = args[safe: 1] as? String ?? ""
                    let message: URLSessionWebSocketTask.Message
                    if args[safe: 2] as? Bool == true {
                        guard let data = Data(base64Encoded: text) else { throw HTTPFailure(status: -1, message: "Invalid socket binary data") }
                        message = .data(data)
                    } else { message = .string(text) }
                    socket.task.send(message) { error in
                        if let error { callback.error(error.localizedDescription) }
                        else { callback.success() }
                    }
                case "close":
                    let code = args[safe: 1] as? Int ?? 1000
                    guard let closeCode = URLSessionWebSocketTask.CloseCode(rawValue: code), code == 1000 || (3000...4999).contains(code) else { throw HTTPFailure(status: -1, message: "Invalid socket close code") }
                    let reason = Data((args[safe: 2] as? String ?? "Normal closure").utf8)
                    guard reason.count <= 123 else { throw HTTPFailure(status: -1, message: "Socket close reason exceeds 123 bytes") }
                    socket.task.cancel(with: closeCode, reason: reason)
                    callback.success()
                default: callback.error("Unknown WebSocket action: \(action)")
                }
            } catch { callback.error(error.localizedDescription) }
        }
    }
}

private final class NativeSocket: NSObject, URLSessionWebSocketDelegate, @unchecked Sendable {
    private(set) var task: URLSessionWebSocketTask!
    var binaryType: String
    private let queue: DispatchQueue
    private let onFinish: () -> Void
    private var session: URLSession!
    private var listener: Callback?
    private var pending: [[String: Any]] = []
    private var state = 0
    private var reading = false

    init(args: [Any], queue: DispatchQueue, onFinish: @escaping () -> Void) throws {
        guard let address = args[safe: 0] as? String, let url = URL(string: address),
              ["ws", "wss"].contains(url.scheme?.lowercased() ?? ""), url.host != nil else { throw HTTPFailure(status: -5, message: "Expected a WebSocket URL") }
        self.queue = queue
        self.onFinish = onFinish
        binaryType = args[safe: 3] as? String ?? ""
        super.init()
        var request = URLRequest(url: url)
        request.allHTTPHeaderFields = args[safe: 2] as? [String: String] ?? [:]
        if let protocols = args[safe: 1] as? [String], !protocols.isEmpty { request.setValue(protocols.joined(separator: ","), forHTTPHeaderField: "Sec-WebSocket-Protocol") }
        request.timeoutInterval = 10
        let delegates = OperationQueue()
        delegates.maxConcurrentOperationCount = 1
        delegates.underlyingQueue = queue
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil
        session = URLSession(configuration: configuration, delegate: self, delegateQueue: delegates)
        task = session.webSocketTask(with: request)
    }

    func listen(_ callback: Callback) {
        listener = callback
        for event in pending { callback.success(event, keep: event["readyState"] as? Int != 3) }
        pending.removeAll()
        if state == 3 { onFinish() }
        else { receive() }
    }

    func stop() {
        state = 3
        listener = nil
        pending.removeAll()
        session.invalidateAndCancel()
    }

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
        state = 1
        emit(["type": "open", "protocol": `protocol` ?? "", "extensions": ""])
        receive()
    }

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        guard state != 3 else { return }
        state = 3
        emit(["type": "close", "data": ["code": closeCode.rawValue, "reason": reason.flatMap { String(data: $0, encoding: .utf8) } ?? ""]])
        session.finishTasksAndInvalidate()
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let error, state != 3 else { return }
        state = 3
        emit(["type": "error", "data": error.localizedDescription])
        session.finishTasksAndInvalidate()
    }

    private func receive() {
        guard listener != nil, state == 1, !reading else { return }
        reading = true
        task.receive { [weak self] result in
            guard let self else { return }
            self.queue.async {
                self.reading = false
                guard self.state == 1 else { return }
                switch result {
                case .success(.string(let text)): self.emit(["type": "message", "data": text, "isBinary": false])
                case .success(.data(let data)):
                    let asText = self.binaryType != "arraybuffer"
                    self.emit(["type": "message", "data": asText ? String(decoding: data, as: UTF8.self) : data.base64EncodedString(), "isBinary": true, "parseAsText": asText])
                case .failure: return
                @unknown default: return
                }
                self.receive()
            }
        }
    }

    private func emit(_ value: [String: Any]) {
        var event = value
        event["readyState"] = state
        if let listener {
            listener.success(event, keep: state != 3)
            if state == 3 { self.listener = nil; onFinish() }
        } else { pending.append(event) }
    }
}

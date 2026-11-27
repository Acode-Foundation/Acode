import Foundation
import Network

final class LocalHTTPConnection {
    let id = UUID().uuidString
    private let connection: NWConnection
    private let queue: DispatchQueue
    private var parser = LocalHTTPParser()
    private var sentContinue = false
    private var started = false
    private var finished = false
    private var headOnly = false
    private var deadline: DispatchWorkItem?
    var onClose: (() -> Void)?
    var onRequest: ((LocalHTTPRequest) -> Void)?

    init(_ connection: NWConnection, queue: DispatchQueue) {
        self.connection = connection
        self.queue = queue
    }

    func start() {
        connection.stateUpdateHandler = { [weak self] state in
            if case .failed = state { self?.cancel() }
            if case .cancelled = state { self?.cancel() }
        }
        connection.start(queue: queue)
        armTimeout()
        receive()
    }

    func cancel() {
        guard !finished else { return }
        finished = true
        deadline?.cancel()
        connection.cancel()
        onClose?()
        onClose = nil
        onRequest = nil
    }

    func startResponse(status: Int, headers: [String: String], length: UInt64? = nil) {
        guard !started, !finished else { return }
        started = true
        var text = "HTTP/1.1 \(status) \(HTTPURLResponse.localizedString(forStatusCode: status))\r\n"
        for (name, value) in headers where !["content-length", "connection", "transfer-encoding"].contains(name.lowercased()) {
            guard LocalHTTPParser.isToken(name) else { continue }
            let values = name.lowercased() == "set-cookie" ? value.components(separatedBy: "\n") : [value]
            for item in values where !item.contains("\r") && !item.contains("\n") && !item.contains("\0") { text += "\(name): \(item)\r\n" }
        }
        if let length { text += "Content-Length: \(length)\r\n" }
        text += "Connection: close\r\n\r\n"
        connection.send(content: Data(text.utf8), completion: .contentProcessed { [weak self] error in if error != nil { self?.cancel() } })
    }

    func send(_ data: Data, completion: @escaping () -> Void = {}) {
        guard started, !finished else { return }
        if headOnly { completion(); return }
        connection.send(content: data, completion: .contentProcessed { [weak self] error in
            guard let self, !self.finished else { return }
            if error != nil { self.cancel(); return }
            self.armTimeout()
            completion()
        })
    }

    func end() {
        guard !finished else { return }
        connection.send(content: nil, contentContext: .finalMessage, isComplete: true, completion: .contentProcessed { [weak self] _ in self?.cancel() })
    }

    func respond(status: Int, headers: [String: String] = [:], body: Data = Data()) {
        startResponse(status: status, headers: headers, length: UInt64(body.count))
        send(body) { [weak self] in self?.end() }
    }

    /// Sends `101 Switching Protocols` and hands the socket to the new protocol, which owns it from then on.
    func upgrade(headers: [String: String]) -> NWConnection? {
        guard !started, !finished else { return nil }
        started = true
        finished = true
        deadline?.cancel()
        var text = "HTTP/1.1 101 Switching Protocols\r\n"
        for (name, value) in headers { text += "\(name): \(value)\r\n" }
        connection.send(content: Data((text + "\r\n").utf8), completion: .contentProcessed { _ in })
        connection.stateUpdateHandler = nil
        onClose?()
        onClose = nil
        onRequest = nil
        return connection
    }

    func sendFile(_ file: FileHandle, count: UInt64) {
        guard !finished, !headOnly, count > 0 else { try? file.close(); end(); return }
        do {
            let data = try file.read(upToCount: Int(min(count, 64 * 1024))) ?? Data()
            guard !data.isEmpty else { try? file.close(); cancel(); return }
            send(data) { [weak self] in
                guard let self else { try? file.close(); return }
                self.sendFile(file, count: count - UInt64(data.count))
            }
        } catch { try? file.close(); cancel() }
    }

    private func receive() {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] data, _, complete, error in
            guard let self, !self.finished else { return }
            if error != nil { self.cancel(); return }
            do {
                if let request = try self.parser.append(data ?? Data()) {
                    self.headOnly = request.method == "HEAD"
                    self.armTimeout()
                    self.onRequest?(request)
                    return
                }
                if complete { self.respond(status: 400); return }
                if self.parser.expectsContinue, !self.sentContinue {
                    self.sentContinue = true
                    self.connection.send(content: Data("HTTP/1.1 100 Continue\r\n\r\n".utf8), completion: .contentProcessed { _ in })
                }
                self.receive()
            } catch { self.respond(status: (error as? LocalHTTPError)?.status ?? 400) }
        }
    }

    private func armTimeout() {
        deadline?.cancel()
        let item = DispatchWorkItem { [weak self] in self?.cancel() }
        deadline = item
        queue.asyncAfter(deadline: .now() + 60, execute: item)
    }
}

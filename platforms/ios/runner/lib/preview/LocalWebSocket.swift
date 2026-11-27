import CryptoKit
import Foundation
import Network

/// Server side of RFC 6455 on a socket upgraded by `LocalHTTPConnection`. Not thread-safe; use its queue.
final class LocalWebSocket {
    private static let maximumMessage = 16 * 1024 * 1024
    private let connection: NWConnection
    private var buffer = Data()
    private var message = Data()
    private var messageIsText = false
    private var closed = false
    var onMessage: ((Data, Bool) -> Void)?
    var onClose: (() -> Void)?

    static func accept(_ request: LocalHTTPRequest, client: LocalHTTPConnection) -> LocalWebSocket? {
        guard request.method == "GET", request.headers["upgrade"]?.lowercased() == "websocket",
              let key = request.headers["sec-websocket-key"],
              let connection = client.upgrade(headers: ["Upgrade": "websocket", "Connection": "Upgrade",
                                                        "Sec-WebSocket-Accept": acceptKey(key)]) else { return nil }
        return LocalWebSocket(connection)
    }

    private init(_ connection: NWConnection) {
        self.connection = connection
        connection.stateUpdateHandler = { [weak self] state in
            switch state {
            case .failed, .cancelled: self?.close()
            default: break
            }
        }
        receive()
    }

    func send(_ payload: Data, text: Bool = false, completion: @escaping () -> Void = {}) {
        guard !closed else { return }
        connection.send(content: Self.frame(text ? 0x1 : 0x2, payload), completion: .contentProcessed { [weak self] error in
            if error != nil { self?.close(); return }
            completion()
        })
    }

    func close() {
        guard !closed else { return }
        closed = true
        connection.send(content: Self.frame(0x8, Data([0x03, 0xE8])), completion: .contentProcessed { [connection] _ in
            connection.cancel()
        })
        let handler = onClose
        onClose = nil
        onMessage = nil
        handler?()
    }

    private func receive() {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] data, _, complete, error in
            guard let self, !self.closed else { return }
            if let data { buffer.append(data) }
            do {
                while !closed, let frame = try nextFrame() { handle(frame) }
            } catch { close(); return }
            if error != nil || complete { close(); return }
            if !closed { receive() }
        }
    }

    private func handle(_ frame: (opcode: UInt8, final: Bool, payload: Data)) {
        switch frame.opcode {
        case 0x0, 0x1, 0x2:
            if frame.opcode != 0x0 { message = Data(); messageIsText = frame.opcode == 0x1 }
            message.append(frame.payload)
            guard message.count <= Self.maximumMessage else { close(); return }
            if frame.final { onMessage?(message, messageIsText); message = Data() }
        case 0x8: close()
        case 0x9: connection.send(content: Self.frame(0xA, frame.payload), completion: .contentProcessed { _ in })
        default: break
        }
    }

    private func nextFrame() throws -> (opcode: UInt8, final: Bool, payload: Data)? {
        let head = [UInt8](buffer.prefix(14))
        guard head.count >= 2 else { return nil }
        var length = Int(head[1] & 0x7F)
        var offset = 2
        if length == 126 {
            guard head.count >= 4 else { return nil }
            length = Int(head[2]) << 8 | Int(head[3])
            offset = 4
        } else if length == 127 {
            guard head.count >= 10 else { return nil }
            guard head[2] & 0x80 == 0 else { throw LocalHTTPError(400) }
            length = head[2..<10].reduce(0) { $0 << 8 | Int($1) }
            offset = 10
        }
        guard length <= Self.maximumMessage else { throw LocalHTTPError(413) }
        let masked = head[1] & 0x80 != 0
        let start = offset + (masked ? 4 : 0)
        guard buffer.count >= start + length else { return nil }
        var payload = [UInt8](buffer[(buffer.startIndex + start)..<(buffer.startIndex + start + length)])
        if masked {
            let mask = [UInt8](buffer[(buffer.startIndex + offset)..<(buffer.startIndex + offset + 4)])
            for index in payload.indices { payload[index] ^= mask[index & 3] }
        }
        buffer = Data(buffer.dropFirst(start + length))
        return (head[0] & 0x0F, head[0] & 0x80 != 0, Data(payload))
    }

    private static func frame(_ opcode: UInt8, _ payload: Data) -> Data {
        var frame = Data([0x80 | opcode])
        if payload.count < 126 {
            frame.append(UInt8(payload.count))
        } else if payload.count <= 0xFFFF {
            frame.append(contentsOf: [126, UInt8(payload.count >> 8), UInt8(payload.count & 0xFF)])
        } else {
            frame.append(127)
            for shift in stride(from: 56, through: 0, by: -8) { frame.append(UInt8((payload.count >> shift) & 0xFF)) }
        }
        frame.append(payload)
        return frame
    }

    private static func acceptKey(_ key: String) -> String {
        Data(Insecure.SHA1.hash(data: Data((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").utf8))).base64EncodedString()
    }
}

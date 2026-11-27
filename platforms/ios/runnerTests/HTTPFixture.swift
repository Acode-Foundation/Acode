import Foundation
import Network

final class HTTPFixture: @unchecked Sendable {
    private let listener: NWListener
    private let queue = DispatchQueue(label: "app.acode.tests.http")
    private var connections: [NWConnection] = []
    private var stalledDownloads: [NWConnection] = []
    private let websocket: Bool
    let downloadName = "acode-preview-" + UUID().uuidString + ".bin"
    var origin: String { "http://127.0.0.1:\(listener.port!.rawValue)" }

    init(websocket: Bool = false) throws {
        self.websocket = websocket
        let parameters = NWParameters.tcp
        if websocket {
            let options = NWProtocolWebSocket.Options()
            options.autoReplyPing = true
            options.setClientRequestHandler(queue) { protocols, headers in
                let authorized = headers.contains { $0.name.lowercased() == "x-acode-fixture" && $0.value == "test" }
                return NWProtocolWebSocket.Response(status: authorized ? .accept : .reject, subprotocol: protocols.first)
            }
            parameters.defaultProtocolStack.applicationProtocols.insert(options, at: 0)
        }
        listener = try NWListener(using: parameters, on: .any)
    }

    func start() async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            listener.stateUpdateHandler = { [weak self] state in
                switch state {
                case .ready: self?.listener.stateUpdateHandler = nil; continuation.resume()
                case .failed(let error): self?.listener.stateUpdateHandler = nil; continuation.resume(throwing: error)
                default: break
                }
            }
            listener.newConnectionHandler = { [weak self] connection in
                guard let self else { connection.cancel(); return }
                self.connections.append(connection)
                connection.start(queue: self.queue)
                if self.websocket { self.receiveSocket(connection) }
                else { self.receive(connection, buffer: Data()) }
            }
            listener.start(queue: queue)
        }
    }

    func stop() {
        queue.async { self.listener.cancel(); self.connections.forEach { $0.cancel() }; self.connections.removeAll() }
    }

    func completeDownloads() {
        queue.async {
            let remainder = Data(repeating: 0, count: 16_777_216 - 262_144)
            for connection in self.stalledDownloads {
                connection.send(content: remainder, completion: .contentProcessed { _ in connection.cancel() })
            }
            self.stalledDownloads.removeAll()
        }
    }

    private func receiveSocket(_ connection: NWConnection) {
        connection.receiveMessage { [weak self] data, context, _, error in
            guard let self, error == nil, let metadata = context?.protocolMetadata(definition: NWProtocolWebSocket.definition) as? NWProtocolWebSocket.Metadata else { connection.cancel(); return }
            let reply = NWProtocolWebSocket.Metadata(opcode: metadata.opcode)
            if metadata.opcode == .close { reply.closeCode = metadata.closeCode }
            let context = NWConnection.ContentContext(identifier: "echo", metadata: [reply])
            connection.send(content: data, contentContext: context, isComplete: true, completion: .contentProcessed { _ in
                if metadata.opcode == .close { connection.cancel() }
                else { self.receiveSocket(connection) }
            })
        }
    }

    private func receive(_ connection: NWConnection, buffer: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] data, _, complete, error in
            guard let self, let data, error == nil else { connection.cancel(); return }
            var buffer = buffer; buffer.append(data)
            if let range = buffer.range(of: Data("\r\n\r\n".utf8)) {
                let head = String(decoding: buffer[..<range.lowerBound], as: UTF8.self)
                let size = head.components(separatedBy: "\r\n").first(where: { $0.lowercased().hasPrefix("content-length:") }).flatMap { Int($0.split(separator: ":", maxSplits: 1)[1].trimmingCharacters(in: .whitespaces)) } ?? 0
                if buffer.count - range.upperBound >= size {
                    self.respond(connection, head: head, body: Data(buffer[range.upperBound...])); return
                }
            }
            if complete { connection.cancel() }
            else { self.receive(connection, buffer: buffer) }
        }
    }

    private func respond(_ connection: NWConnection, head: String, body: Data) {
        let requestPath = head.split(separator: " ").dropFirst().first.map(String.init) ?? "/"
        let path = requestPath.hasPrefix("/api/") ? String(requestPath.dropFirst(4)) : requestPath
        if ["/stalled-download", "/broken-download"].contains(path) {
            if path == "/stalled-download" { stalledDownloads.append(connection) }
            let header = "HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nContent-Disposition: attachment; filename=\"\(downloadName)\"\r\nContent-Length: 16777216\r\nConnection: close\r\n\r\n"
            let prefix = Data((0..<262144).map { UInt8($0 % 256) })
            connection.send(content: Data(header.utf8) + prefix, completion: .contentProcessed { _ in
                if path == "/broken-download" { self.queue.asyncAfter(deadline: .now() + 0.5) { connection.cancel() } }
            })
            return
        }
        var status = "200 OK"
        var headers = "Content-Type: application/octet-stream\r\n"
        var data = Data([0, 127, 128, 159, 255])
        switch path {
        case "/preview-transfers":
            headers = "Content-Type: text/html; charset=utf-8\r\n"
            data = Data("""
                <!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
                <title>Preview transfers</title><h1>Preview transfers</h1>
                <p><a href="/download" download>Download fixture</a></p>
                <p><label>Upload fixture <input type="file" id="upload" multiple></label></p>
                <pre id="result">No file selected</pre>
                <script>upload.onchange=async()=>{
                    window.uploaded=await Promise.all(Array.from(upload.files,async file=>({name:file.name,bytes:Array.from(new Uint8Array(await file.arrayBuffer()))})));
                    result.textContent=JSON.stringify(window.uploaded);
                };</script>
                """.utf8)
        case "/download": headers += "Content-Disposition: attachment; filename=\"\(downloadName)\"\r\n"
        case "/cached-preview":
            headers = "Content-Type: text/html; charset=utf-8\r\nCache-Control: max-age=3600\r\n"
            data = Data("<!doctype html><title>Cached fixture \(UUID().uuidString)</title>".utf8)
        case "/page": headers = "Content-Type: text/html; charset=utf-8\r\n"; data = Data("<!doctype html><title>HTTP fixture</title><p>Page ✓</p>".utf8)
        case "/echo": data = body
        case "/redirect": status = "302 Found"; headers += "Location: /bytes\r\n"; data = Data()
        case "/external-redirect": status = "302 Found"; headers += "Location: http://localhost:1/\r\n"; data = Data()
        case "/empty": status = "204 No Content"; data = Data()
        case "/error": status = "422 Unprocessable Entity"; data = Data("invalid request".utf8)
        case "/cookie": headers += "Set-Cookie: session=fixture; Path=/\r\n"; data = Data("cookie".utf8)
        case "/cookie-redirect": status = "302 Found"; headers += "Location: /cookie-check\r\nSet-Cookie: session=redirect-fixture; Path=/\r\n"; data = Data()
        case "/cookie-check": data = Data(head.utf8)
        case "/stream": data = Data((0..<524288).map { UInt8($0 % 256) })
        default: break
        }
        let packet = Data("HTTP/1.1 \(status)\r\n\(headers)Content-Length: \(data.count)\r\nConnection: close\r\n\r\n".utf8) + data
        let send = { connection.send(content: packet, completion: .contentProcessed { _ in connection.cancel() }) }
        if path == "/slow" { queue.asyncAfter(deadline: .now() + 2, execute: send) }
        else { send() }
    }
}

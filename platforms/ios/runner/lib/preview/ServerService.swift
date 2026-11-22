import Foundation

final class ServerService: BaseService {
    private final class Server {
        let transport: LocalHTTPServer
        var handler: Callback?
        var replacementHandler: Callback?
        var pending: [String: (LocalHTTPRequest, LocalHTTPConnection)] = [:]
        var starters: [Callback] = []
        var ready = false
        init(_ transport: LocalHTTPServer) { self.transport = transport }
    }

    private let queue = DispatchQueue(label: "app.acode.preview")
    private var servers: [Int: Server] = [:]
    private var stopping: [Int: Server] = [:]

    override func reset() {
        queue.async {
            let active = Array(self.servers.values)
            self.servers.removeAll()
            for server in active { server.handler?.release(); server.transport.stop() }
            for server in self.stopping.values {
                server.replacementHandler?.release(); server.replacementHandler = nil
                for callback in server.starters { callback.error("Server stopped") }
                server.starters.removeAll()
            }
        }
    }

    override func exec(action: String, args: [Any], callback: Callback) {
        queue.async { [self] in
            guard let port = args[safe: 0] as? Int, (1...65535).contains(port) else { callback.error("Invalid server port"); return }
            do {
                switch action {
                case "start": try self.start(port, callback: callback)
                case "stop":
                    guard let server = self.servers.removeValue(forKey: port) else { callback.error("Server not started on port \(port)"); return }
                    server.handler?.release()
                    self.stopping[port] = server
                    server.transport.stop { [weak self] in
                        guard let self else { return }
                        self.stopping.removeValue(forKey: port)
                        callback.success()
                        let starters = server.starters; server.starters.removeAll()
                        for starter in starters {
                            do { try self.start(port, callback: starter) }
                            catch { starter.error(error.localizedDescription) }
                        }
                        if let replacement = self.servers[port] { replacement.handler = server.replacementHandler }
                        else { server.replacementHandler?.release() }
                        server.replacementHandler = nil
                    }
                case "setOnRequestHandler":
                    if let server = self.servers[port] {
                        server.handler?.release(); server.handler = callback
                    } else if let server = self.stopping[port], !server.starters.isEmpty {
                        server.replacementHandler?.release(); server.replacementHandler = callback
                    } else { callback.error("Server not started on port \(port)") }
                case "send":
                    guard let server = self.servers[port] else { callback.error("Server not running"); return }
                    guard let id = args[safe: 1] as? String, let (request, client) = server.pending.removeValue(forKey: id),
                          let response = args[safe: 2] as? [String: Any] else { callback.error("Invalid preview response"); return }
                    do { try PreviewResponse.send(response, request: request, client: client); callback.success() }
                    catch {
                        client.respond(status: FileFailure.code(error) == 1 ? 404 : 403)
                        callback.error(error.localizedDescription)
                    }
                default: callback.error("Unknown Server action: \(action)")
                }
            } catch { callback.error(error.localizedDescription) }
        }
    }

    private func start(_ port: Int, callback: Callback) throws {
        if let server = stopping[port] { server.starters.append(callback); return }
        if let server = servers[port] {
            if server.ready { callback.success("Server started on port \(port)") }
            else { server.starters.append(callback) }
            return
        }
        let server = Server(try LocalHTTPServer(port: port, queue: queue))
        servers[port] = server
        server.starters.append(callback)
        server.transport.onRequest = { [weak server] request, client in
            guard let server, let handler = server.handler else { client.respond(status: 503); return }
            server.pending[client.id] = (request, client)
            let cleanup = client.onClose
            client.onClose = { [weak server, weak client] in
                cleanup?()
                if let client { server?.pending.removeValue(forKey: client.id) }
            }
            var payload = request.payload
            payload["requestId"] = client.id
            handler.success(payload, keep: true)
        }
        server.transport.start { [weak self, weak server] result in
            guard let server else { return }
            let callbacks = server.starters
            server.starters.removeAll()
            switch result {
            case .success:
                server.ready = true
                for callback in callbacks { callback.success("Server started on port \(port)") }
            case .failure(let error):
                if self?.servers[port] === server { self?.servers.removeValue(forKey: port); server.handler?.release() }
                for callback in callbacks { callback.error(error.localizedDescription) }
            }
        }
    }
}

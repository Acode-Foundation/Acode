import Foundation
import UIKit

/// Serves the AXS HTTP/WebSocket API from the host so terminal traffic never
/// passes through emulated sockets. Guest shells are the only emulated part.
final class TerminalServer {
    static let shared = TerminalServer()
    private static let port = 8767
    private static let origins: Set = ["https://localhost", "acode://localhost"]
    private static let captureLimit = 16 * 1024 * 1024
    private let queue = DispatchQueue(label: "app.acode.terminal", qos: .userInitiated)
    private let runtime = AlpineRuntime.shared
    private var server: LocalHTTPServer?
    private var listening = false
    private var shell = ""
    private var sessions: [Int32: TerminalSession] = [:]

    private init() {
        // iOS reclaims listening sockets of suspended apps; sessions outlive the listener.
        NotificationCenter.default.addObserver(forName: UIApplication.willEnterForegroundNotification, object: nil, queue: nil) { [weak self] _ in
            self?.queue.async { self?.relisten() }
        }
    }

    var isRunning: Bool { queue.sync { listening } }

    func start(shell: String, completion: @escaping (Error?) -> Void) {
        queue.async { [self] in
            guard server == nil else { completion(nil); return }
            self.shell = shell
            listen(completion)
        }
    }

    func stop() {
        queue.async { [self] in
            for session in sessions.values { terminate(session) }
            sessions.removeAll()
            server?.stop()
            server = nil
            listening = false
        }
    }

    private func listen(_ completion: @escaping (Error?) -> Void = { _ in }) {
        do {
            let server = try LocalHTTPServer(port: Self.port, loopback: true, queue: queue)
            self.server = server
            server.onRequest = { [weak self] request, client in self?.route(request, client) }
            server.start { [weak self, weak server] result in
                guard let self, self.server === server else { return }
                switch result {
                case .success:
                    listening = true
                    completion(nil)
                case .failure(let error):
                    self.server = nil
                    listening = false
                    completion(error)
                }
            }
        } catch { completion(error) }
    }

    private func relisten() {
        guard let server else { return }
        listening = false
        server.stop { [weak self] in self?.queue.async { self?.listen() } }
    }

    private func route(_ request: LocalHTTPRequest, _ client: LocalHTTPConnection) {
        let path = request.target.split(separator: "?", maxSplits: 1).first.map(String.init) ?? ""
        let parts = path.split(separator: "/").map(String.init)
        let origin = request.headers["origin"].flatMap { Self.origins.contains($0) ? $0 : nil }
        let respond = { (status: Int, body: Any) in Self.respond(client, status: status, body: body, origin: origin) }
        let session = parts.count >= 2 && parts[0] == "terminals" ? Int32(parts[1]).flatMap { sessions[$0] } : nil
        switch (request.method, parts.count) {
        case ("OPTIONS", _): respond(204, "")
        case ("GET", 0): respond(200, "Acode terminal server")
        case ("GET", 1) where parts[0] == "status": respond(200, "OK")
        case ("POST", 1) where parts[0] == "terminals": create(request, respond)
        case ("POST", 1) where parts[0] == "execute-command": execute(request, respond)
        case ("GET", 2) where parts[0] == "terminals":
            guard let session else { respond(404, ["error": "Session not found"]); return }
            guard let socket = LocalWebSocket.accept(request, client: client) else { respond(400, ["error": "WebSocket upgrade required"]); return }
            session.attach(socket)
        case ("POST", 3) where parts[0] == "terminals" && parts[2] == "resize":
            guard let session else { respond(404, ["error": "Session not found"]); return }
            guard let size = Self.size(request.body) else { respond(400, ["error": "Invalid terminal size"]); return }
            session.resize(rows: size.rows, cols: size.cols)
            respond(200, ["success": true])
        case ("POST", 3) where parts[0] == "terminals" && parts[2] == "terminate":
            guard let session else { respond(404, ["error": "Session not found"]); return }
            sessions.removeValue(forKey: session.pid)
            terminate(session)
            respond(200, ["success": true])
        default: respond(404, ["error": "Not found"])
        }
    }

    private func create(_ request: LocalHTTPRequest, _ respond: @escaping (Int, Any) -> Void) {
        guard let size = Self.size(request.body) else { respond(400, ["error": "Invalid terminal size"]); return }
        let shell = shell
        runtime.queue.async { [self] in
            do {
                let session = try runtime.startTerminal(shell, rows: size.rows, cols: size.cols, queue: queue)
                queue.async { [self, session] in
                    sessions[session.pid] = session
                    session.onFinish = { [weak self, weak session] in
                        if let session { self?.sessions.removeValue(forKey: session.pid) }
                    }
                    respond(200, String(session.pid))
                }
            } catch {
                queue.async { respond(500, ["error": error.localizedDescription]) }
            }
        }
    }

    /// Matches AXS: `sh -c` on an 80×24 PTY in `cwd` (default HOME), answered when the
    /// shell exits or after 30 s. Pipe-based execution stays available as `Executor.execute`.
    private func execute(_ request: LocalHTTPRequest, _ respond: @escaping (Int, Any) -> Void) {
        let body = (try? JSONSerialization.jsonObject(with: request.body)) as? [String: Any] ?? [:]
        guard let command = body["command"] as? String else { respond(400, ["output": "", "error": "Command is required"]); return }
        let directory = (body["cwd"] as? String ?? body["u_cwd"] as? String).flatMap { $0.isEmpty ? nil : $0 }
        let script = (directory.map { "cd \(shellQuote($0)); " } ?? "") + "exec sh -c \(shellQuote(command))"
        var answered = false
        let answer = { (status: Int, output: String, error: String?) in
            guard !answered else { return }
            answered = true
            respond(status, ["output": Self.stripEscapes(output), "error": error.map { $0 as Any } ?? NSNull()])
        }
        let run = { [self] in
            do {
                let session = try runtime.startTerminal(script, rows: 24, cols: 80, queue: queue, scrollbackLimit: Self.captureLimit)
                queue.async { [self, session] in
                    session.onExit = { [weak session] _ in
                        answer(200, String(decoding: session?.capturedOutput ?? Data(), as: UTF8.self), nil)
                    }
                    // Background children can outlive the shell, so the deadline tracks the response.
                    queue.asyncAfter(deadline: .now() + 30) { [self] in
                        guard !answered else { return }
                        terminate(session)
                        answer(500, "", "Command execution timed out")
                    }
                }
            } catch {
                queue.async { answer(500, "", error.localizedDescription) }
            }
        }
        runtime.queue.async { [self] in
            guard let directory else { run(); return }
            do {
                try runtime.start("test -d \(shellQuote(directory))", completion: { [self] status, _, _ in
                    if status == 0 { run() } else { queue.async { answer(400, "", "Working directory does not exist") } }
                })
            } catch {
                queue.async { answer(500, "", error.localizedDescription) }
            }
        }
    }

    private func terminate(_ session: TerminalSession) {
        session.terminate()
        runtime.killTerminal(session)
    }

    private static func size(_ body: Data) -> (rows: Int, cols: Int)? {
        let json = (try? JSONSerialization.jsonObject(with: body)) as? [String: Any] ?? [:]
        let value = { (key: String) -> Int? in
            let number = (json[key] as? NSNumber)?.intValue ?? (json[key] as? String).flatMap { Int($0) }
            return number.flatMap { (1...Int(UInt16.max)).contains($0) ? $0 : nil }
        }
        guard let rows = value("rows"), let cols = value("cols") else { return nil }
        return (rows, cols)
    }

    private static func respond(_ client: LocalHTTPConnection, status: Int, body: Any, origin: String?) {
        var headers = ["Access-Control-Allow-Methods": "*", "Access-Control-Allow-Headers": "*"]
        if let origin { headers["Access-Control-Allow-Origin"] = origin }
        let data: Data
        if let text = body as? String {
            data = Data(text.utf8)
            headers["Content-Type"] = "text/plain; charset=utf-8"
        } else {
            data = (try? JSONSerialization.data(withJSONObject: body)) ?? Data()
            headers["Content-Type"] = "application/json"
        }
        client.respond(status: status, headers: headers, body: data)
    }

    private static func stripEscapes(_ text: String) -> String {
        text.replacingOccurrences(of: "\u{1B}\\[[0-9;?]*[A-Za-z]", with: "", options: .regularExpression)
    }
}

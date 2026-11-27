import Foundation
import Network

/// Raw WebSocket transport for `Executor.spawnStream` (language servers). Socket
/// I/O runs on its own queue; only process start and kill touch the runtime queue.
final class AlpineStreamServer {
    private let runtime = AlpineRuntime.shared
    private let queue = DispatchQueue(label: "app.acode.alpine.stream", qos: .userInitiated)
    private let listener: NWListener
    private let command: [String]
    private let callback: Callback
    private var connection: NWConnection?
    private var process: AlpineProcess?
    private var stopped = false
    var onStop: (() -> Void)?

    init(command: [String], callback: Callback) throws {
        self.command = command
        self.callback = callback
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: .any)
        let websocket = NWProtocolWebSocket.Options()
        websocket.autoReplyPing = true
        parameters.defaultProtocolStack.applicationProtocols.insert(websocket, at: 0)
        listener = try NWListener(using: parameters)
    }

    func start() {
        listener.stateUpdateHandler = { [weak self] state in
            guard let self else { return }
            switch state {
            case .ready: callback.success(Int(listener.port!.rawValue))
            case .failed(let error): callback.error(error.localizedDescription); shutdown()
            default: break
            }
        }
        listener.newConnectionHandler = { [weak self] connection in self?.accept(connection) }
        listener.start(queue: queue)
    }

    func stop() {
        queue.async { self.shutdown() }
    }

    private func shutdown() {
        guard !stopped else { return }
        stopped = true
        listener.cancel()
        connection?.cancel()
        if let process { runtime.queue.async { [runtime] in runtime.stop(process.id) } }
        process = nil
        let handler = onStop
        onStop = nil
        handler?()
    }

    private func accept(_ connection: NWConnection) {
        guard self.connection == nil else { connection.cancel(); return }
        self.connection = connection
        connection.stateUpdateHandler = { [weak self] state in
            guard let self else { return }
            switch state {
            case .ready: launch(on: connection)
            case .failed, .cancelled: shutdown()
            default: break
            }
        }
        connection.start(queue: queue)
    }

    private func launch(on connection: NWConnection) {
        let script = "exec " + command.map(shellQuote).joined(separator: " ") + " 2>&1"
        let send = { [weak self, connection] (data: Data) in
            let metadata = NWProtocolWebSocket.Metadata(opcode: .binary)
            let context = NWConnection.ContentContext(identifier: "stdout", metadata: [metadata])
            connection.send(content: data, contentContext: context, isComplete: true, completion: .contentProcessed { error in
                if error != nil { self?.stop() }
            })
        }
        runtime.queue.async { [weak self, runtime] in
            do {
                let process = try runtime.start(script, listener: { kind, _ in if kind == "exit" { self?.stop() } }, rawOutput: send)
                self?.queue.async {
                    guard let self, !self.stopped else { runtime.queue.async { runtime.stop(process.id) }; return }
                    self.process = process
                    self.receive()
                }
            } catch { self?.stop() }
        }
    }

    private func receive() {
        connection?.receiveMessage { [weak self] data, context, _, error in
            guard let self else { return }
            let metadata = context?.protocolMetadata(definition: NWProtocolWebSocket.definition) as? NWProtocolWebSocket.Metadata
            if error != nil || metadata?.opcode == .close { shutdown(); return }
            if let data { try? process?.input.fileHandleForWriting.write(contentsOf: data) }
            receive()
        }
    }
}

func shellQuote(_ value: String) -> String {
    "'" + value.replacingOccurrences(of: "'", with: "'\\''") + "'"
}

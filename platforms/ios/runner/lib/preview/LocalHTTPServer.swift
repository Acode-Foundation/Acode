import Foundation
import Network

final class LocalHTTPServer {
    private let listener: NWListener
    private let queue: DispatchQueue
    private var connections: [String: LocalHTTPConnection] = [:]
    private var ready: ((Result<Int, Error>) -> Void)?
    private var stopped = false
    private var stopCallbacks: [() -> Void] = []
    var onRequest: ((LocalHTTPRequest, LocalHTTPConnection) -> Void)?

    init(port: Int, loopback: Bool = false, queue: DispatchQueue) throws {
        guard (0...65535).contains(port), let endpoint = NWEndpoint.Port(rawValue: UInt16(port)) else { throw LocalHTTPError(400) }
        self.queue = queue
        let parameters = NWParameters.tcp
        parameters.allowLocalEndpointReuse = true
        // A port passed to `on:` as well as in requiredLocalEndpoint fails with EINVAL.
        if loopback {
            parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: endpoint)
            listener = try NWListener(using: parameters)
        } else {
            listener = try NWListener(using: parameters, on: endpoint)
        }
        listener.newConnectionLimit = 64
    }

    func start(_ completion: @escaping (Result<Int, Error>) -> Void) {
        ready = completion
        listener.stateUpdateHandler = { [weak self] state in
            guard let self else { return }
            switch state {
            case .ready:
                self.ready?(.success(Int(self.listener.port!.rawValue)))
                self.ready = nil
            case .failed(let error):
                self.ready?(.failure(error)); self.ready = nil; self.stop()
            default: break
            }
        }
        listener.newConnectionHandler = { [weak self] transport in
            guard let self, self.connections.count < 64 else { transport.cancel(); return }
            let client = LocalHTTPConnection(transport, queue: self.queue)
            self.connections[client.id] = client
            client.onClose = { [weak self, weak client] in if let client { self?.connections.removeValue(forKey: client.id) } }
            client.onRequest = { [weak self, weak client] request in
                guard let client else { return }
                self?.onRequest?(request, client)
            }
            client.start()
        }
        listener.start(queue: queue)
    }

    func stop(_ completion: @escaping () -> Void = {}) {
        if stopped { completion(); return }
        stopCallbacks.append(completion)
        ready?(.failure(URLError(.cancelled))); ready = nil
        listener.stateUpdateHandler = { state in
            guard case .cancelled = state else { return }
            self.stopped = true
            self.listener.stateUpdateHandler = nil
            let callbacks = self.stopCallbacks
            self.stopCallbacks.removeAll()
            for callback in callbacks { callback() }
        }
        listener.cancel()
        let active = Array(connections.values)
        connections.removeAll()
        for client in active { client.cancel() }
    }
}

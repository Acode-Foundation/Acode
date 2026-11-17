import Foundation
import CSSH2

final class SSHShell {
    let id = UUID().uuidString
    let cancellation: SSHCancellation
    private let channel: SSHChannel
    private let callback: Callback
    private let queue = DispatchQueue(label: "app.acode.ssh.shell", qos: .userInitiated)
    private var timer: DispatchSourceTimer?
    private var finished = false
    var onClose: (() -> Void)?

    init(connection: SSHConnection, columns: Int, rows: Int, callback: Callback) throws {
        cancellation = connection.cancellation
        channel = try SSHChannel(connection: connection)
        self.callback = callback
        try channel.shell(columns: columns, rows: rows)
        libssh2_keepalive_config(connection.session, 1, 30)
    }

    func start() {
        queue.async { [self] in
            self.callback.success(["type": "ready", "sessionId": self.id], keep: true)
            let timer = DispatchSource.makeTimerSource(queue: self.queue)
            timer.schedule(deadline: .now(), repeating: .milliseconds(20))
            timer.setEventHandler { [weak self] in self?.read() }
            self.timer = timer
            timer.resume()
        }
    }

    func perform(_ action: String, args: [Any], callback: Callback) {
        queue.async {
            guard !self.finished else { callback.error("SSH shell is not connected"); return }
            do {
                if action == "writeShell" { try self.channel.write(args[safe: 1] as? String ?? "") }
                else { try self.channel.resize(columns: Self.dimension(args[safe: 1], default: 80), rows: Self.dimension(args[safe: 2], default: 24)) }
                callback.success()
            } catch { SSHFailure.report(error, to: callback); self.finish(error) }
        }
    }

    func close() {
        cancellation.cancel()
        queue.async { self.finish(nil) }
    }

    static func dimension(_ value: Any?, default fallback: Int) -> Int { min(65535, max(1, value as? Int ?? fallback)) }

    private func read() {
        guard !finished else { return }
        do {
            try cancellation.check()
            let text = try channel.read()
            if !text.isEmpty { callback.success(["type": "data", "sessionId": id, "data": text], keep: true) }
            if channel.ended && channel.readCount == 0 { finish(nil); return }
            var next: Int32 = 0
            let status = libssh2_keepalive_send(channel.connection.session, &next)
            if status < 0 && status != LIBSSH2_ERROR_EAGAIN { throw channel.connection.failure() }
        } catch { finish(error) }
    }

    private func finish(_ error: Error?) {
        guard !finished else { return }
        finished = true
        timer?.cancel(); timer = nil
        let tail = channel.remainingText()
        if !tail.isEmpty { callback.success(["type": "data", "sessionId": id, "data": tail], keep: true) }
        if let error, (error as? SSHFailure)?.payload["cancelled"] as? Bool != true {
            callback.success(["type": "error", "sessionId": id, "message": error.localizedDescription])
        } else { callback.success(["type": "exit", "sessionId": id, "exitCode": channel.exitCode]) }
        onClose?()
    }
}

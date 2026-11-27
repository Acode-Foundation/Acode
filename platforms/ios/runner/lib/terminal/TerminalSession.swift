import AcodeAlpine
import Foundation

/// One command on a guest pseudo-terminal. Output arrives on guest threads;
/// everything else runs on the terminal server's queue.
final class TerminalSession {
    static let replayLimit = 256 * 1024
    private static let unsentLimit = 1024 * 1024
    private static let frameSize = 8 * 1024
    private static let coalesceDelay = DispatchTimeInterval.milliseconds(8)
    private let queue: DispatchQueue
    private let scrollbackLimit: Int
    private let output = NSLock()
    private var scrollback = Data()
    private var pending = Data()
    private var unsent = 0
    private var attached = false
    private var flushScheduled = false
    private var socket: LocalWebSocket?
    private var input = Data()
    private var handle: OpaquePointer?
    private var status: Int32?
    private(set) var pid: Int32 = 0
    var onFinish: (() -> Void)?
    var onExit: ((Int32) -> Void)?

    /// Keeps the last `scrollbackLimit` bytes for replay on reattach or for `capturedOutput`.
    init(queue: DispatchQueue, scrollbackLimit: Int = replayLimit) {
        self.queue = queue
        self.scrollbackLimit = scrollbackLimit
    }

    var capturedOutput: Data {
        output.lock()
        defer { output.unlock() }
        return Data(scrollback.suffix(scrollbackLimit))
    }

    /// Queried by blocking guest writers, which wait while the client is behind.
    var congested: Bool {
        output.lock()
        defer { output.unlock() }
        return attached && unsent > Self.unsentLimit
    }

    func started(pid: Int32, handle: OpaquePointer) {
        self.pid = pid
        self.handle = handle
    }

    /// Replays recent output, then streams live output until the socket closes.
    func attach(_ socket: LocalWebSocket) {
        if let status {
            socket.send(Self.exitMessage(status), text: true) { socket.close() }
            onFinish?()
            return
        }
        self.socket?.close()
        output.lock()
        let history = scrollback.suffix(Self.replayLimit)
        pending.removeAll()
        unsent = 0
        attached = true
        output.unlock()
        self.socket = socket
        socket.onMessage = { [weak self] data, _ in self?.write(data) }
        socket.onClose = { [weak self, weak socket] in
            guard let self, self.socket === socket else { return }
            self.detach()
        }
        if !history.isEmpty { socket.send(Data(history)) }
    }

    func resize(rows: Int, cols: Int) {
        guard let handle else { return }
        alpine_terminal_resize(handle, Int32(rows), Int32(cols))
    }

    func terminate() {
        socket?.close()
        close()
    }

    /// Called by the runtime when the shell exits.
    func finish(_ code: Int32) {
        queue.async { [self] in
            guard status == nil else { return }
            status = code
            close()
            flush()
            onExit?(code)
            onExit = nil
            guard let socket else { return }
            socket.send(Self.exitMessage(code), text: true) { socket.close() }
            onFinish?()
        }
    }

    /// Runs on guest threads.
    func receive(_ data: Data) {
        output.lock()
        scrollback.append(data)
        if scrollback.count > scrollbackLimit * 2 {
            scrollback = Data(scrollback.suffix(scrollbackLimit))
        }
        guard attached else { output.unlock(); return }
        pending.append(data)
        unsent += data.count
        let immediate = pending.count >= Self.frameSize
        let schedule = !flushScheduled
        flushScheduled = true
        output.unlock()
        if immediate { queue.async { self.flush() } }
        else if schedule { queue.asyncAfter(deadline: .now() + Self.coalesceDelay) { self.flush() } }
    }

    private func flush() {
        output.lock()
        let data = pending
        pending.removeAll(keepingCapacity: true)
        flushScheduled = false
        output.unlock()
        guard !data.isEmpty, let socket else { return }
        socket.send(data) { [weak self] in self?.acknowledge(data.count) }
    }

    private func acknowledge(_ count: Int) {
        output.lock()
        unsent = max(0, unsent - count)
        output.unlock()
        wakeWriters()
    }

    private func detach() {
        socket = nil
        output.lock()
        attached = false
        pending.removeAll()
        unsent = 0
        output.unlock()
        wakeWriters()
    }

    private func wakeWriters() {
        guard let handle else { return }
        alpine_terminal_drained(handle)
    }

    private func write(_ data: Data) {
        let idle = input.isEmpty
        input.append(data)
        if idle { drainInput() }
    }

    // The guest line buffer holds 4 KiB, so large pastes are fed as the shell reads.
    private func drainInput() {
        guard let handle, !input.isEmpty else { input.removeAll(); return }
        let written = input.withUnsafeBytes { bytes in
            alpine_terminal_input(handle, bytes.bindMemory(to: CChar.self).baseAddress, bytes.count)
        }
        if written > 0 { input = Data(input.dropFirst(written)) }
        guard !input.isEmpty else { return }
        queue.asyncAfter(deadline: .now() + .milliseconds(10)) { [weak self] in self?.drainInput() }
    }

    private func close() {
        guard let handle else { return }
        self.handle = nil
        input.removeAll()
        alpine_terminal_close(handle)
    }

    private static func exitMessage(_ code: Int32) -> Data {
        let message: [String: Any] = [
            "type": "exit",
            "data": ["exit_code": code, "signal": NSNull(),
                     "message": code == 0 ? "Process exited successfully" : "Process exited with non-zero status"],
        ]
        return (try? JSONSerialization.data(withJSONObject: message)) ?? Data()
    }
}

let terminalCallbacks = AlpineTerminalCallbacks(
    output: { context, data, length in
        guard let context, let data else { return }
        Unmanaged<TerminalSession>.fromOpaque(context).takeUnretainedValue().receive(Data(bytes: data, count: length))
    },
    congested: { context in
        guard let context else { return false }
        return Unmanaged<TerminalSession>.fromOpaque(context).takeUnretainedValue().congested
    },
    release: { context in
        guard let context else { return }
        Unmanaged<TerminalSession>.fromOpaque(context).release()
    }
)

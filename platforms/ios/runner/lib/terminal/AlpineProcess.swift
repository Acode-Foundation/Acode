import Foundation

final class AlpineProcess {
    let id = UUID().uuidString
    let command: String
    let background: Bool
    let startedAt = Date().timeIntervalSince1970 * 1000
    let input = Pipe()
    let output = Pipe()
    let errors = Pipe()
    var pid: Int32 = 0
    var status: Int32?
    var listener: ((String, String) -> Void)?
    var rawOutput: ((Data) -> Void)?
    var completion: ((Int32, String, String) -> Void)?
    private var pending = ["stdout": Data(), "stderr": Data()]
    private var collected = ["stdout": "", "stderr": ""]
    private var closed = Set<String>()

    init(command: String, background: Bool) {
        self.command = command
        self.background = background
    }

    var info: [String: Any] {
        ["id": id, "pid": pid, "command": command, "alpine": true,
         "startedAt": startedAt, "background": background]
    }

    /// Line output and exit bookkeeping run on `queue`; raw stdout goes straight
    /// from the pipe's reader thread so streaming never waits behind guest calls.
    func observe(on queue: DispatchQueue) {
        for (kind, pipe) in [("stdout", output), ("stderr", errors)] {
            let raw = kind == "stdout" ? rawOutput : nil
            pipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
                let data = handle.availableData
                if let raw, !data.isEmpty { raw(data); return }
                if data.isEmpty { handle.readabilityHandler = nil }
                queue.async { self?.receive(data, kind: kind) }
            }
        }
    }

    func didStart() {
        try? input.fileHandleForReading.close()
        try? output.fileHandleForWriting.close()
        try? errors.fileHandleForWriting.close()
    }

    func finish(_ code: Int32) {
        status = code
        completeIfDrained()
    }

    func write(_ text: String) throws {
        try input.fileHandleForWriting.write(contentsOf: Data((text + "\n").utf8))
    }

    private func receive(_ data: Data, kind: String) {
        pending[kind, default: Data()].append(data)
        // Executor uses lines on Android. Buffering also preserves split UTF-8 sequences.
        while let end = pending[kind]!.firstIndex(of: 10) {
            let line = pending[kind]!.prefix(upTo: end)
            let text = String(decoding: line, as: UTF8.self)
            pending[kind]!.removeSubrange(...end)
            deliver(text, kind: kind)
        }
        if data.isEmpty {
            if !pending[kind]!.isEmpty {
                deliver(String(decoding: pending[kind]!, as: UTF8.self), kind: kind)
                pending[kind]!.removeAll()
            }
            closed.insert(kind)
            completeIfDrained()
        }
    }

    private func deliver(_ text: String, kind: String) {
        listener?(kind, text)
        if completion != nil { collected[kind, default: ""] += text + "\n" }
    }

    private func completeIfDrained() {
        guard let status, closed.count == 2 else { return }
        listener?("exit", String(status))
        listener = nil
        completion?(status, collected["stdout"]!.trimmingCharacters(in: .newlines),
                    collected["stderr"]!.trimmingCharacters(in: .newlines))
        completion = nil
        try? input.fileHandleForWriting.close()
        try? output.fileHandleForReading.close()
        try? errors.fileHandleForReading.close()
    }
}

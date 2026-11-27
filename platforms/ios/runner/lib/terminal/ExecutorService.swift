import AcodeAlpine
import Foundation

class ExecutorService: BaseService {
    var background: Bool { false }
    private let runtime = AlpineRuntime.shared
    private var streams: [AlpineStreamServer] = []

    override func exec(action: String, args: [Any], callback: Callback) {
        runtime.queue.async { [self] in
            do {
                let value = args[safe: 0] as? String ?? ""
                switch action {
                case "start":
                    let process = try runtime.start(value, background: background)
                    callback.success(process.id, keep: true)
                    process.listener = { kind, text in callback.success("\(kind):\(text)", keep: kind != "exit") }
                case "exec": try runtime.execute(value, callback: callback)
                case "write":
                    guard let process = runtime.processes[value], process.status == nil else { throw terminalError("Process not running") }
                    try process.write(args[safe: 1] as? String ?? "")
                    callback.success()
                case "stop": runtime.stop(value); callback.success()
                case "isRunning":
                    callback.success(runtime.processes[value].map { alpine_running($0.pid) } == true ? "running" : "stopped")
                case "listProcesses": callback.success(runtime.processes.values.filter { $0.background == background && $0.status == nil }.map(\.info))
                case "listAllProcesses": try listAllProcesses(callback)
                case "killProcess":
                    guard let pid = args[safe: 0] as? Int, pid > 1 else { throw terminalError("Invalid process") }
                    guard alpine_kill(Int32(pid)) == 0 else { throw terminalError("Process not running") }
                    callback.success()
                case "stopService": runtime.stopAll(background: background); callback.success()
                case "setProotDebug", "moveToForeground", "moveToBackground": callback.success()
                case "spawn":
                    guard let command = args[safe: 0] as? [String], !command.isEmpty else { throw terminalError("Command is required") }
                    let server = try AlpineStreamServer(command: command, callback: callback)
                    streams.append(server)
                    server.onStop = { [weak self, weak server] in
                        self?.runtime.queue.async { self?.streams.removeAll { $0 === server } }
                    }
                    server.start()
                case "loadLibrary": throw terminalError("Loading native libraries directly from JavaScript is not supported.")
                default: callback.error("Unknown Executor action: \(action)")
                }
            } catch { callback.error(error.localizedDescription) }
        }
    }

    override func reset() {
        runtime.queue.async { [self] in
            streams.forEach { $0.stop() }
            streams.removeAll()
            // AXS and its PTYs survive a WebView reload, as they do on Android.
            for process in runtime.processes.values where process.background == background { process.listener = nil }
        }
    }

    private func listAllProcesses(_ callback: Callback) throws {
        try runtime.start("busybox ps -o pid,ppid,comm,args", completion: { status, output, errors in
            guard status == 0 else { callback.error(errors); return }
            let rows: [[String: Any]] = output.split(separator: "\n").dropFirst().compactMap { line in
                let fields = line.split(maxSplits: 3, whereSeparator: \.isWhitespace)
                guard fields.count >= 3, let pid = Int(fields[0]), let parent = Int(fields[1]) else { return nil }
                return ["pid": pid, "ppid": parent, "name": String(fields[2]),
                        "command": fields.count > 3 ? String(fields[3]) : String(fields[2]),
                        "state": "", "memory": 0, "isSelf": pid == 1]
            }
            callback.success(rows)
        })
    }
}

final class BackgroundExecutorService: ExecutorService {
    override var background: Bool { true }
}

func terminalError(_ message: String) -> NSError {
    NSError(domain: "AcodeTerminal", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
}

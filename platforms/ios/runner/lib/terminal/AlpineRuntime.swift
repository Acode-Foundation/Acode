import AcodeAlpine
import Foundation
import UIKit

final class AlpineRuntime {
    static let shared = AlpineRuntime()
    let queue = DispatchQueue(label: "app.acode.alpine", qos: .userInitiated)
    let files = AppFiles.shared
    private(set) var processes: [String: AlpineProcess] = [:]
    private var terminals: [Int32: TerminalSession] = [:]
    private var booted = false
    private var prepared = false
    private var preparing: [() -> Void]?
    private var suspended = false
    private(set) var maintaining = false
    private var sharedPaths = Set<String>()

    // The guest root must sit outside every host bind mount. Otherwise the
    // emulator resolves its own root through that mount and loses Linux metadata.
    var root: URL { files.data.deletingLastPathComponent().appendingPathComponent("Alpine") }
    var installed: Bool { FileManager.default.fileExists(atPath: files.data.appendingPathComponent(".configured").path) }
    var assets: URL { Bundle.main.resourceURL!.appendingPathComponent("Alpine") }
    // Bun FFI needs JIT; optimizing and concurrent workers are unsafe in this guest.
    var environment: String {
        ["PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", "HOME=/public",
         "PREFIX=/acode", "ALPINE_ROOT=/", "TERM=xterm-256color", "SHELL=/bin/bash",
         "ANDROID_TZ=\(TimeZone.current.identifier)", "GODEBUG=asyncpreemptoff=1", "GOMAXPROCS=2",
         "PYTHONMALLOC=malloc", "PYTHONDONTWRITEBYTECODE=1",
         "BUN_JSC_useDFGJIT=0", "BUN_JSC_useFTLJIT=0", "BUN_JSC_useConcurrentJIT=0",
         "BUN_JSC_numberOfGCMarkers=1", "BUN_JSC_useConcurrentGC=0"].joined(separator: "\0") + "\0\0"
    }

    private init() {
        // Guest servers keep listening across suspension; iOS reclaims their host sockets meanwhile.
        let center = NotificationCenter.default
        center.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in
            self?.suspend()
        }
        center.addObserver(forName: UIApplication.willEnterForegroundNotification, object: nil, queue: .main) { [weak self] _ in
            self?.resume()
        }
    }

    func extract() throws {
        guard !FileManager.default.fileExists(atPath: root.path) else { return }
        let staging = root.appendingPathExtension("installing")
        try? FileManager.default.removeItem(at: staging)
        var message = [CChar](repeating: 0, count: 1024)
        guard alpine_import(assets.appendingPathComponent("alpine.rootfs").path, staging.path, &message, message.count) else {
            try? FileManager.default.removeItem(at: staging)
            throw failure(String(cString: message))
        }
        try FileManager.default.moveItem(at: staging, to: root)
    }

    func boot() throws {
        guard !booted else { return }
        guard FileManager.default.fileExists(atPath: root.appendingPathComponent("meta.db").path) else {
            throw failure("Terminal not installed. Please install terminal first.")
        }
        try check(alpine_boot(root.appendingPathComponent("data").path, { pid, status in
            let runtime = AlpineRuntime.shared
            runtime.queue.async { runtime.didExit(pid: pid, status: status) }
        }))
        let publicDirectory = files.data.appendingPathComponent("public")
        try FileManager.default.createDirectory(at: publicDirectory, withIntermediateDirectories: true)
        for guest in ["/public", "/home", "/root"] { try check(alpine_bind(guest, publicDirectory.path, false)) }
        try check(alpine_bind("/acode", files.data.path, false))
        try check(alpine_bind("/acode-assets", assets.path, true))
        // Update the server binary on every app launch while preserving guest packages and user rc files.
        for name in ["axs", "init-alpine.sh"] {
            let destination = files.data.appendingPathComponent(name)
            try? FileManager.default.removeItem(at: destination)
            try FileManager.default.copyItem(at: assets.appendingPathComponent(name), to: destination)
        }
        try check(alpine_chmod("/acode/axs", 0o755))
        booted = true
        try shareFiles()
    }

    @discardableResult
    func start(_ command: String, background: Bool = false,
               listener: ((String, String) -> Void)? = nil,
               rawOutput: ((Data) -> Void)? = nil,
               completion: ((Int32, String, String) -> Void)? = nil) throws -> AlpineProcess {
        try ready()
        let process = AlpineProcess(command: command, background: background)
        process.listener = listener
        process.rawOutput = rawOutput
        process.completion = completion
        let pid = shellScript(command).withCString { script in
            environment.withCString { env in
                alpine_start(script, env, process.input.fileHandleForReading.fileDescriptor,
                             process.output.fileHandleForWriting.fileDescriptor, process.errors.fileHandleForWriting.fileDescriptor)
            }
        }
        process.didStart()
        try check(pid)
        process.pid = pid
        processes[process.id] = process
        process.observe(on: queue)
        return process
    }

    /// Starts a command on a guest pseudo-terminal whose I/O runs on `terminalQueue`.
    func startTerminal(_ command: String, rows: Int, cols: Int, queue terminalQueue: DispatchQueue,
                       scrollbackLimit: Int = TerminalSession.replayLimit) throws -> TerminalSession {
        try ready()
        let session = TerminalSession(queue: terminalQueue, scrollbackLimit: scrollbackLimit)
        let context = Unmanaged.passRetained(session).toOpaque()
        var handle: OpaquePointer?
        let pid = shellScript(command).withCString { script in
            environment.withCString { env in
                alpine_terminal_start(script, env, Int32(rows), Int32(cols), context, terminalCallbacks, &handle)
            }
        }
        try check(pid)
        guard let handle else { throw failure("Could not open a terminal") }
        session.started(pid: pid, handle: handle)
        terminals[pid] = session
        return session
    }

    /// Kills a hung-up shell that ignored SIGHUP once it had a chance to exit.
    func killTerminal(_ session: TerminalSession) {
        queue.asyncAfter(deadline: .now() + 1) { [self] in
            if terminals[session.pid] === session { _ = alpine_kill(session.pid) }
        }
    }

    /// Runs the shared setup script once per boot so each shell only has to start bash.
    func prepare(_ completion: @escaping () -> Void) {
        if prepared { completion(); return }
        guard preparing == nil else { preparing?.append(completion); return }
        preparing = [completion]
        do {
            try start("exec /bin/sh /acode/init-alpine.sh --prepare", completion: { [self] status, _, errors in
                if status == 0 { prepared = true }
                else { print("Alpine setup exited with status \(status): \(errors)") }
                finishPreparing()
            })
        } catch {
            print("Alpine setup failed: \(error.localizedDescription)")
            finishPreparing()
        }
    }

    func execute(_ command: String, callback: Callback) throws {
        try start(command, completion: { status, output, errors in
            if status == 0 { callback.success(output) }
            else { callback.error(errors.isEmpty ? "Command exited with status \(status): \(output)" : errors) }
        })
    }

    func stop(_ id: String) {
        if let process = processes[id], process.status == nil { _ = alpine_kill(process.pid) }
    }

    func stopAll(background: Bool) {
        for process in processes.values where process.background == background { stop(process.id) }
    }

    func unmount(completion: @escaping (Error?) -> Void) {
        guard !maintaining else { completion(failure("Alpine maintenance is in progress")); return }
        guard booted else { completion(nil); return }
        maintaining = true
        alpine_stop_all()
        waitForShutdown(deadline: Date().addingTimeInterval(10), completion: completion)
    }

    func shareFiles() throws {
        guard booted else { return }
        for (name, url) in files.allRoots() where name != "application" {
            for path in Set([url.path, url.resolvingSymlinksInPath().path]) {
                if sharedPaths.contains(path) { continue }
                try check(alpine_bind(path, url.path, false))
                sharedPaths.insert(path)
            }
        }
    }

    private func ready() throws {
        guard !maintaining else { throw failure("Alpine maintenance is in progress") }
        try boot()
        try shareFiles()
    }

    private func shellScript(_ command: String) -> String {
        "cd /public; " + command
    }

    private func finishPreparing() {
        let waiting = preparing ?? []
        preparing = nil
        for completion in waiting { completion() }
    }

    private func waitForShutdown(deadline: Date, completion: @escaping (Error?) -> Void) {
        if alpine_idle() {
            do {
                try check(alpine_unmount())
                booted = false
                prepared = false
                sharedPaths.removeAll()
                maintaining = false
                completion(nil)
            } catch { maintaining = false; completion(error) }
        } else if Date() >= deadline {
            maintaining = false
            completion(failure("Alpine processes are still stopping. Try again."))
        } else {
            queue.asyncAfter(deadline: .now() + .milliseconds(50)) { self.waitForShutdown(deadline: deadline, completion: completion) }
        }
    }

    private func didExit(pid: Int32, status: Int32) {
        terminals.removeValue(forKey: pid)?.finish(status)
        if let process = processes.values.first(where: { $0.pid == pid }) { process.finish(status) }
        alpine_reap()
        processes = processes.filter { $0.value.status == nil || $0.value.completion != nil || $0.value.listener != nil }
    }

    private func suspend() {
        guard !suspended else { return }
        suspended = true
        alpine_suspend()
    }

    private func resume() {
        guard suspended else { return }
        suspended = false
        alpine_resume()
    }

    private func check(_ result: Int32) throws {
        if result < 0 { throw failure("Alpine runtime error \(result)") }
    }

    private func failure(_ message: String) -> NSError {
        NSError(domain: "AcodeAlpine", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }
}

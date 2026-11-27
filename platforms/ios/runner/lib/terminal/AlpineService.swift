import Foundation

final class AlpineService: BaseService {
    private let runtime = AlpineRuntime.shared

    override func exec(action: String, args: [Any], callback: Callback) {
        runtime.queue.async { [self] in
            do {
                switch action {
                case "isSupported": callback.success(true)
                case "isInstalled": callback.success(runtime.installed)
                case "isAxsRunning":
                    try runtime.shareFiles()
                    callback.success(TerminalServer.shared.isRunning)
                case "install": try install(callback)
                case "backup", "restore", "uninstall", "clearBackup": try AlpineMaintenance.perform(action, callback: callback)
                case "startAxs":
                    try runtime.shareFiles()
                    let failsafe = args[safe: 0] as? Bool == true
                    let start = {
                        TerminalServer.shared.start(shell: failsafe ? "exec sh" : "exec bash --rcfile /initrc -i") { error in
                            if let error { callback.error(error.localizedDescription) } else { callback.success() }
                        }
                    }
                    if failsafe { start() } else { runtime.prepare(start) }
                case "stopAxs":
                    TerminalServer.shared.stop()
                    callback.success()
                default: callback.error("Unknown Alpine action: \(action)")
                }
            } catch { callback.error(error.localizedDescription) }
        }
    }

    private func install(_ callback: Callback) throws {
        try runtime.extract()
        try runtime.boot()
        let setup = """
        set -e
        printf 'nameserver 8.8.8.8\nnameserver 1.1.1.1\n' > /etc/resolv.conf
        chmod +x /acode/axs
        ln -sf /acode/axs /usr/local/bin/axs
        /bin/sh /acode/init-alpine.sh --installing
        """
        try runtime.start(setup, listener: { kind, text in
            callback.success(["type": kind, "data": text], keep: kind != "exit")
        })
    }
}

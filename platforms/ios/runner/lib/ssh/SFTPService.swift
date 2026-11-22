import Foundation

final class SFTPService: BaseService {
    let profiles = SSHProfileStore()
    let control = DispatchQueue(label: "app.acode.sftp.control")
    let operations = DispatchQueue(label: "app.acode.sftp.files", qos: .userInitiated)
    var attempts: [String: SSHAttempt] = [:]
    var shells: [String: SSHShell] = [:]
    var activeCancellation: SSHCancellation?
    var client: SFTPClient?
    var generation = UUID()

    override func exec(action: String, args: [Any], callback: Callback) {
        control.async {
            do {
                let id = args[safe: 0] as? String ?? ""
                switch action {
                case "saveProfile", "editProfile":
                    let (id, profile) = try self.profiles.save(args, legacy: action == "saveProfile")
                    callback.success(action == "saveProfile" ? id : profile.info(id: id))
                case "getProfileInfo": callback.success(try self.profiles.profile(id).info(id: id))
                case "deleteProfile": try self.deleteProfile(id, callback: callback)
                case "connectUsingProfile", "testProfile", "openShellUsingProfile": try self.connect(action, args: args, callback: callback)
                case "cancelConnection": self.attempts[id]?.cancel(); callback.success()
                case "writeShell", "resizeShell":
                    guard let shell = self.shells[id] else { throw SecretFailure("SSH shell is not connected") }
                    shell.perform(action, args: args, callback: callback)
                case "closeShell": self.shells.removeValue(forKey: id)?.close(); callback.success()
                case "close":
                    self.generation = UUID()
                    self.activeCancellation?.cancel(); self.activeCancellation = nil
                    for attempt in self.attempts.values where !attempt.shell { attempt.cancel() }
                    self.operations.async { self.client = nil; callback.success() }
                default: self.fileAction(action, args: args, callback: callback)
                }
            } catch { SSHFailure.report(error, to: callback) }
        }
    }

    override func reset() {
        control.async {
            self.generation = UUID()
            for attempt in self.attempts.values { attempt.cancel() }
            self.attempts.removeAll()
            for shell in self.shells.values { shell.close() }
            self.shells.removeAll()
            self.activeCancellation?.cancel(); self.activeCancellation = nil
            self.operations.async { self.client = nil }
        }
    }

    private func fileAction(_ action: String, args: [Any], callback: Callback) {
        operations.async {
            do {
                if action == "isConnected" {
                    callback.success(self.client?.connection.isConnected == true ? self.client!.profileID as Any : 0)
                    return
                }
                guard let client = self.client, client.connection.isConnected else { throw SecretFailure("Not connected") }
                let path = try client.path(args[safe: 0] as? String ?? "")
                switch action {
                case "pwd": callback.success(client.directory)
                case "lsDir": callback.success(try client.list(path))
                case "stat": callback.success(try client.stat(path))
                case "mkdir": try client.mkdir(path); callback.success()
                case "rm": try client.remove(path, force: args[safe: 1] as? Bool ?? false, recursive: args[safe: 2] as? Bool ?? false); callback.success()
                case "rename": try client.rename(path, to: client.path(args[safe: 1] as? String ?? "")); callback.success()
                case "createFile": try client.create(path, contents: args[safe: 1] as? String ?? ""); callback.success()
                case "getFile": try client.download(path, to: args[safe: 1] as? String ?? ""); callback.success()
                case "putFile": try client.upload(args[safe: 1] as? String ?? "", to: path); callback.success()
                case "exec": callback.success(try SSHChannel(connection: client.connection).execute(args[safe: 0] as? String ?? ""))
                default: throw SecretFailure("SFTP action is not available: " + action)
                }
            } catch { SSHFailure.report(error, to: callback) }
        }
    }

    private func deleteProfile(_ id: String, callback: Callback) throws {
        let profile = try profiles.profile(id)
        let attempt = SSHAttempt(callback: callback, shell: true)
        let requestID = UUID().uuidString
        attempts[requestID] = attempt
        DispatchQueue.global(qos: .userInitiated).async { [self] in
            defer { self.control.async { self.attempts.removeValue(forKey: requestID) } }
            do {
                guard try SSHPrompts.confirm(title: "Delete saved SSH credentials?", message: "Remove the encrypted SFTP/SSH profile for \(profile.username)@\(profile.hostname)?", button: "Delete", destructive: true, presenter: { [weak self] in self?.viewController }, cancellation: attempt.cancellation) else {
                    throw SecretFailure("Profile deletion was cancelled")
                }
                try self.profiles.remove(id)
                attempt.finish { callback.success() }
            } catch { attempt.finish { SSHFailure.report(error, to: callback) } }
        }
    }
}

final class SSHAttempt {
    let cancellation = SSHCancellation()
    let callback: Callback
    let shell: Bool
    private let lock = NSLock()
    private var completed = false
    init(callback: Callback, shell: Bool) { self.callback = callback; self.shell = shell }
    func finish(_ completion: () -> Void) {
        lock.lock(); defer { lock.unlock() }
        guard !completed else { return }
        completed = true; completion()
    }
    func cancel() { cancellation.cancel(); finish { SSHFailure.report(SSHFailure.cancelled, to: callback) } }
}

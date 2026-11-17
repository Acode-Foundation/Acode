import Foundation

extension SFTPService {
    func connect(_ action: String, args: [Any], callback: Callback) throws {
        let shell = action == "openShellUsingProfile"
        let profileID = args[safe: 0] as? String ?? ""
        let profile = try profiles.profile(profileID)
        let suppliedID = !shell ? args[safe: 1] as? String ?? "" : ""
        let requestID = suppliedID.isEmpty ? UUID().uuidString : suppliedID
        guard attempts[requestID] == nil else { throw SecretFailure("An SFTP connection with this request ID is already running") }
        let attempt = SSHAttempt(callback: callback, shell: shell)
        if !shell {
            for previous in attempts.values where !previous.shell { previous.cancel() }
            generation = UUID()
        }
        let currentGeneration = generation
        attempts[requestID] = attempt
        let timeout = shell ? 10 : min(30, max(1, (args[safe: 2] as? Double ?? 10000) / 1000))
        DispatchQueue.global(qos: .userInitiated).async { [self] in
            do {
                let connection = try SSHConnection(cancellation: attempt.cancellation)
                try connection.connect(profile, timeout: timeout) { [self] key, algorithm in
                    try self.profiles.verify(endpoint: profile.endpoint, key: key, algorithm: algorithm) { [self] fingerprint in
                        try SSHPrompts.confirm(title: "Unknown SSH host", message: "This is the first connection to \(profile.endpoint).\n\nKey type: \(algorithm)\nFingerprint: \(fingerprint)\n\nVerify this fingerprint before trusting the host.", button: "Trust and connect", presenter: { [weak self] in self?.viewController }, cancellation: attempt.cancellation)
                    }
                }
                if shell {
                    let terminal = try SSHShell(connection: connection, columns: SSHShell.dimension(args[safe: 1], default: 80), rows: SSHShell.dimension(args[safe: 2], default: 24), callback: callback)
                    self.control.async { [self, terminal] in
                        self.attempts.removeValue(forKey: requestID)
                        guard (try? attempt.cancellation.check()) != nil else { terminal.close(); return }
                        terminal.onClose = { [weak self, weak terminal] in
                            guard let self, let id = terminal?.id else { return }
                            self.control.async { self.shells.removeValue(forKey: id) }
                        }
                        self.shells[terminal.id] = terminal
                        attempt.finish { terminal.start() }
                    }
                } else {
                    let client = try SFTPClient(connection: connection, profileID: profileID)
                    self.control.async {
                        guard self.generation == currentGeneration, (try? attempt.cancellation.check()) != nil else {
                            self.attempts.removeValue(forKey: requestID); attempt.cancel(); return
                        }
                        self.activeCancellation?.cancel()
                        self.activeCancellation = attempt.cancellation
                        self.operations.async {
                            defer { self.control.async { self.attempts.removeValue(forKey: requestID) } }
                            guard (try? attempt.cancellation.check()) != nil else { attempt.cancel(); return }
                            self.client = client
                            attempt.finish { callback.success(action == "testProfile" ? client.directory : nil) }
                        }
                    }
                }
            } catch {
                if let failure = error as? SSHFailure { SSHPrompts.changed(failure, presenter: { [weak self] in self?.viewController }) }
                self.control.async { self.attempts.removeValue(forKey: requestID) }
                attempt.finish { SSHFailure.report(error, to: callback) }
            }
        }
    }
}

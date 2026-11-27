import Foundation
import CryptoKit

struct SSHProfile: Codable {
    let hostname: String
    let port: Int
    let username: String
    let authType: String
    var password: String = ""
    var privateKey: Data = Data()
    var passphrase: String = ""

    var endpoint: String { "\(hostname):\(port)" }

    func info(id: String) -> [String: Any] {
        ["profileId": id, "hostname": hostname, "port": port, "username": username, "authType": authType]
    }
}

final class SSHProfileStore {
    private let profiles: SecretStore
    private let hosts: SecretStore
    private let lock = NSRecursiveLock()
    private let hostLock = NSLock()

    init(namespace: String = "ssh") {
        profiles = SecretStore(namespace: namespace + ".profiles")
        hosts = SecretStore(namespace: namespace + ".knownHosts")
    }

    func profile(_ id: String) throws -> SSHProfile {
        guard id.hasPrefix("profile-") else { throw SecretFailure("Invalid SFTP profile ID") }
        let value = try profiles.get(id)
        guard !value.isEmpty else { throw SecretFailure("SFTP profile was not found") }
        return try JSONDecoder().decode(SSHProfile.self, from: Data(value.utf8))
    }

    func save(_ args: [Any], legacy: Bool) throws -> (String, SSHProfile) {
        lock.lock(); defer { lock.unlock() }
        let requested = (args[safe: 0] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let id = ["", "null", "undefined"].contains(requested.lowercased()) ? "profile-" + UUID().uuidString : requested
        if legacy && id == requested { throw SecretFailure("Legacy profile import cannot replace a saved profile") }
        let existing = id == requested ? try profile(id) : nil
        let host = (args[safe: 1] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let username = (args[safe: 3] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let port = args[safe: 2] as? Int ?? 22
        let auth = args[safe: 4] as? String ?? "password"
        guard !host.isEmpty, !host.contains("\0"), !username.isEmpty, !username.contains("\0") else { throw SecretFailure("Hostname and username are required") }
        guard (1...65535).contains(port) else { throw SecretFailure("Port must be between 1 and 65535") }
        guard ["password", "key"].contains(auth) else { throw SecretFailure("Invalid SSH authentication type") }
        var value = SSHProfile(hostname: host, port: port, username: username, authType: auth)
        if auth == "key" {
            let path = args[safe: 6] as? String ?? ""
            if !path.isEmpty {
                let url = try AppFiles.shared.resolve(path)
                value.privateKey = try AppFiles.shared.coordinate(url) { try Data(contentsOf: $0) }
                value.passphrase = args[safe: 7] as? String ?? ""
            } else if let existing, existing.authType == "key" {
                value.privateKey = existing.privateKey; value.passphrase = existing.passphrase
            } else { throw SecretFailure("Select a private key file") }
        } else {
            value.password = args[safe: 5] as? String ?? ""
            if value.password.isEmpty, let existing, existing.authType == "password" { value.password = existing.password }
        }
        let encoded = try JSONEncoder().encode(value)
        try profiles.set(id, value: String(decoding: encoded, as: UTF8.self))
        return (id, value)
    }

    func remove(_ id: String) throws { try profiles.remove(id) }

    func verify(endpoint: String, key: Data, algorithm: String, confirm: (String) throws -> Bool) throws {
        hostLock.lock(); defer { hostLock.unlock() }
        let fingerprint = "SHA256:" + Data(SHA256.hash(data: key)).base64EncodedString().replacingOccurrences(of: "=", with: "")
        let trusted = try hosts.get(endpoint)
        if !trusted.isEmpty {
            let saved = try JSONDecoder().decode(SSHHost.self, from: Data(trusted.utf8))
            guard saved.key == key else {
                throw SSHFailure(["code": "HOST_KEY_CHANGED", "host": endpoint, "fingerprint": fingerprint, "expectedFingerprint": saved.fingerprint])
            }
        } else {
            guard try confirm(fingerprint) else { throw SSHFailure(["code": "HOST_KEY_REJECTED", "host": endpoint, "fingerprint": fingerprint]) }
            let host = SSHHost(key: key, algorithm: algorithm, fingerprint: fingerprint)
            try hosts.set(endpoint, value: String(decoding: JSONEncoder().encode(host), as: UTF8.self))
        }
    }
}

private struct SSHHost: Codable {
    let key: Data
    let algorithm: String
    let fingerprint: String
}

struct SSHFailure: LocalizedError {
    let payload: [String: Any]
    init(_ payload: [String: Any]) { self.payload = payload }
    var errorDescription: String? { payload["message"] as? String ?? payload["code"] as? String }
    static var cancelled: SSHFailure { SSHFailure(["code": "SFTP_CONNECT_CANCELLED", "message": "SFTP connection cancelled", "cancelled": true, "nonRetryable": true]) }
    static func report(_ error: Error, to callback: Callback) {
        callback.error((error as? SSHFailure)?.payload ?? ["message": error.localizedDescription])
    }
}

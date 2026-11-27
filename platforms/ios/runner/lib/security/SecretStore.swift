import Foundation
import Security

struct SecretStore {
    let namespace: String

    func get(_ key: String, default fallback: String = "") throws -> String {
        var query = query(key)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return fallback }
        try check(status)
        guard let data = result as? Data, let value = String(data: data, encoding: .utf8) else { throw SecretFailure("Invalid stored secret") }
        return value
    }

    func set(_ key: String, value: String) throws {
        let query = query(key)
        let data = Data(value.utf8)
        let status = SecItemUpdate(query as CFDictionary, [kSecValueData: data] as CFDictionary)
        if status == errSecItemNotFound {
            var item = query
            item[kSecValueData as String] = data
            item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            try check(SecItemAdd(item as CFDictionary, nil))
        } else { try check(status) }
    }

    func remove(_ key: String) throws { try delete(query(key)) }
    func clear() throws { try delete(query(nil)) }

    private func query(_ key: String?) -> [String: Any] {
        var query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                  kSecAttrService as String: (Bundle.main.bundleIdentifier ?? "app.acode") + "." + namespace,
                                  kSecAttrSynchronizable as String: false]
        if let key { query[kSecAttrAccount as String] = key }
        return query
    }

    private func delete(_ query: [String: Any]) throws {
        let status = SecItemDelete(query as CFDictionary)
        if status != errSecItemNotFound { try check(status) }
    }

    private func check(_ status: OSStatus) throws {
        if status != errSecSuccess { throw SecretFailure("Keychain operation failed (\(status))") }
    }
}

struct SecretFailure: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}

struct SecureToken {
    static func generate(bytes: Int = 32) throws -> String {
        var data = [UInt8](repeating: 0, count: bytes)
        guard SecRandomCopyBytes(kSecRandomDefault, data.count, &data) == errSecSuccess else { throw SecretFailure("Cannot generate a secure token") }
        return data.map { String(format: "%02x", $0) }.joined()
    }

    static func matches(_ first: String?, _ second: String?) -> Bool {
        guard let first, let second else { return false }
        let a = Array(first.utf8), b = Array(second.utf8)
        guard a.count == b.count else { return false }
        var difference: UInt8 = 0
        for index in a.indices { difference |= a[index] ^ b[index] }
        return difference == 0
    }
}

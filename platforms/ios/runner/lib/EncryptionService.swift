import Foundation

final class EncryptionService: BaseService {

    override func exec(action: String, args: [Any], callback: Callback) {
        switch action {
        case "encrypt": encrypt(args: args, callback: callback)
        case "decrypt": decrypt(args: args, callback: callback)
        default:        callback.error("Unknown action: \(action)")
        }
    }

    // XOR cipher then Base64 — matches Android Encryption.java exactly.

    private func encrypt(args: [Any], callback: Callback) {
        guard let message  = args[safe: 0] as? String,
              let password = args[safe: 1] as? String else {
            callback.error("message and password required"); return
        }
        let msgBytes  = Array(message.utf8)
        let passBytes = Array(password.utf8)
        guard !passBytes.isEmpty else { callback.error("password must not be empty"); return }
        let xored = msgBytes.enumerated().map { i, b in b ^ passBytes[i % passBytes.count] }
        callback.success(Data(xored).base64EncodedString())
    }

    private func decrypt(args: [Any], callback: Callback) {
        guard let encoded  = args[safe: 0] as? String,
              let password = args[safe: 1] as? String,
              let data     = Data(base64Encoded: encoded) else {
            callback.error("encoded string and password required"); return
        }
        let passBytes = Array(password.utf8)
        guard !passBytes.isEmpty else { callback.error("password must not be empty"); return }
        let xored = data.enumerated().map { i, b in b ^ passBytes[i % passBytes.count] }
        guard let result = String(bytes: xored, encoding: .utf8) else {
            callback.error("Decryption produced invalid UTF-8"); return
        }
        callback.success(result)
    }
}

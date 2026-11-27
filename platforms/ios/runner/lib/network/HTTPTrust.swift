import Foundation
import Security

struct HTTPTrust {
    var mode = "default"
    var certificates: [SecCertificate] = []
    var credential: URLCredential?

    mutating func configureServer(_ mode: String) throws {
        guard ["default", "legacy", "nocheck", "pinned"].contains(mode) else { throw HTTPFailure(status: -2, message: "Unknown server trust mode") }
        var anchors: [SecCertificate] = []
        if mode == "pinned" {
            let directory = Bundle.main.bundleURL.appendingPathComponent("bundle/certificates")
            for url in (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? [] where ["cer", "der"].contains(url.pathExtension.lowercased()) {
                if let certificate = SecCertificateCreateWithData(nil, try Data(contentsOf: url) as CFData) { anchors.append(certificate) }
            }
            guard !anchors.isEmpty else { throw HTTPFailure(status: -2, message: "No pinned certificates in bundle/certificates") }
        }
        self.mode = mode
        certificates = anchors
    }

    mutating func configureClient(_ args: [Any]) throws {
        let mode = args[safe: 0] as? String ?? "none"
        if mode == "none" { credential = nil; return }
        let identity: SecIdentity
        var chain: [SecCertificate]?
        if mode == "buffer" {
            guard let encoded = args[safe: 2] as? String, let data = Data(base64Encoded: encoded) else { throw HTTPFailure(status: -2, message: "Invalid PKCS12 buffer") }
            var imported: CFArray?
            let status = SecPKCS12Import(data as CFData, [kSecImportExportPassphrase: args[safe: 3] as? String ?? ""] as CFDictionary, &imported)
            guard status == errSecSuccess, let item = (imported as? [[String: Any]])?.first,
                  let value = item[kSecImportItemIdentity as String] else { throw HTTPFailure(status: -2, message: "Cannot import client certificate (\(status))") }
            identity = value as! SecIdentity
            chain = item[kSecImportItemCertChain as String] as? [SecCertificate]
        } else if mode == "systemstore" {
            var query: [String: Any] = [kSecClass as String: kSecClassIdentity, kSecReturnRef as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
            if let alias = args[safe: 1] as? String { query[kSecAttrLabel as String] = alias }
            var value: CFTypeRef?
            let status = SecItemCopyMatching(query as CFDictionary, &value)
            guard status == errSecSuccess, let value else { throw HTTPFailure(status: -2, message: "Client identity is unavailable in this app's Keychain") }
            identity = value as! SecIdentity
        } else { throw HTTPFailure(status: -2, message: "Unknown client authentication mode") }
        credential = URLCredential(identity: identity, certificates: chain, persistence: .forSession)
    }

    func respond(_ challenge: URLAuthenticationChallenge, completion: (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        guard challenge.previousFailureCount == 0 else { completion(.cancelAuthenticationChallenge, nil); return }
        let method = challenge.protectionSpace.authenticationMethod
        if method == NSURLAuthenticationMethodClientCertificate {
            completion(credential == nil ? .performDefaultHandling : .useCredential, credential)
        } else if method == NSURLAuthenticationMethodServerTrust, let trust = challenge.protectionSpace.serverTrust {
            if mode == "nocheck" { completion(.useCredential, URLCredential(trust: trust)) }
            else if mode == "pinned" {
                SecTrustSetAnchorCertificates(trust, certificates as CFArray)
                SecTrustSetAnchorCertificatesOnly(trust, true)
                completion(SecTrustEvaluateWithError(trust, nil) ? .useCredential : .cancelAuthenticationChallenge, URLCredential(trust: trust))
            } else { completion(.performDefaultHandling, nil) }
        } else { completion(.performDefaultHandling, nil) }
    }
}

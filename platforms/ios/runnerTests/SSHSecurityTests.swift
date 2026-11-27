import XCTest
@testable import runner

final class SSHSecurityTests: XCTestCase {
    func testProfileEditsKeepCredentialsNativeAndPreserveBlankSecrets() throws {
        let namespace = "ssh-test." + UUID().uuidString
        let store = SSHProfileStore(namespace: namespace)
        defer { try? SecretStore(namespace: namespace + ".profiles").clear() }
        let (id, profile) = try store.save([NSNull(), " host ", 22, " user ", "password", "secret", "", ""], legacy: false)
        XCTAssertTrue(id.hasPrefix("profile-"))
        XCTAssertEqual(profile.hostname, "host")
        XCTAssertEqual(profile.username, "user")
        XCTAssertNil(profile.info(id: id)["password"])
        XCTAssertThrowsError(try store.save([id, "host", 22, "user", "password", "replacement"], legacy: true))
        let (editedID, edited) = try store.save([id, "other", 2200, "new", "password", ""], legacy: false)
        XCTAssertEqual(editedID, id)
        XCTAssertEqual(edited.password, "secret")
        XCTAssertEqual(try SSHProfileStore(namespace: namespace).profile(id).hostname, "other")
        XCTAssertThrowsError(try store.save([id, "host", 0, "user", "password", "changed"], legacy: false))
        XCTAssertEqual(try store.profile(id).password, "secret")
        let key = AppFiles.shared.cache.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: key) }
        try Data("private fixture key".utf8).write(to: key)
        let converted = try store.save([id, "host", 22, "user", "key", "", key.absoluteString, "passphrase"], legacy: false).1
        XCTAssertEqual(converted.password, "")
        XCTAssertNil(converted.info(id: id)["privateKey"])
        let preserved = try store.save([id, "host", 22, "user", "key", "", "", ""], legacy: false).1
        XCTAssertEqual(preserved.privateKey, converted.privateKey)
        XCTAssertEqual(preserved.passphrase, "passphrase")
        try store.remove(id)
        XCTAssertThrowsError(try store.profile(id))
    }

    func testHostTrustPersistsAndChangedKeysCannotBeAccepted() throws {
        let namespace = "ssh-test." + UUID().uuidString
        let store = SSHProfileStore(namespace: namespace)
        defer { try? SecretStore(namespace: namespace + ".knownHosts").clear() }
        let key = Data("first key".utf8)
        XCTAssertThrowsError(try store.verify(endpoint: "host:22", key: key, algorithm: "ssh-rsa", confirm: { _ in false })) { error in
            XCTAssertEqual((error as? SSHFailure)?.payload["code"] as? String, "HOST_KEY_REJECTED")
        }
        try store.verify(endpoint: "host:22", key: key, algorithm: "ssh-rsa") { fingerprint in
            XCTAssertTrue(fingerprint.hasPrefix("SHA256:")); return true
        }
        try SSHProfileStore(namespace: namespace).verify(endpoint: "host:22", key: key, algorithm: "ssh-rsa") { _ in XCTFail("Known key prompted again"); return false }
        XCTAssertThrowsError(try store.verify(endpoint: "host:22", key: Data("changed".utf8), algorithm: "ssh-rsa", confirm: { _ in XCTFail("Changed key offered trust"); return true })) { error in
            let failure = error as? SSHFailure
            XCTAssertEqual(failure?.payload["code"] as? String, "HOST_KEY_CHANGED")
            XCTAssertNotNil(failure?.payload["expectedFingerprint"])
        }
    }

    func testTerminalUnicodeSurvivesEveryByteBoundary() {
        let value = "Acode ✓ 日本語 🦊\r\n"
        let bytes = Data(value.utf8)
        for boundary in 0...bytes.count {
            var decoder = SSHTextDecoder()
            let text = decoder.append(Data(bytes.prefix(boundary))) + decoder.append(Data(bytes.dropFirst(boundary))) + decoder.finish()
            XCTAssertEqual(text, value)
        }
        var decoder = SSHTextDecoder()
        XCTAssertEqual(bytes.map { decoder.append(Data([$0])) }.joined() + decoder.finish(), value)
    }
}

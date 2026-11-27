import XCTest
import WebKit
@testable import runner

@MainActor
final class SSHBridgeSecurityTests: BridgeTestCase {
    func testQuietCommandDoesNotInheritConnectionDeadline() async throws {
        let fixture = try await SSHTestFixture.configuration()
        let port = fixture["port"] as! Int
        let key = Data(base64Encoded: fixture["hostKey"] as! String)!
        let code = try await Task.detached {
            let connection = try SSHConnection(cancellation: SSHCancellation())
            let profile = SSHProfile(hostname: "127.0.0.1", port: port, username: "fixture", authType: "password", password: "fixture-password")
            try connection.connect(profile, timeout: 10) { received, _ in XCTAssertEqual(received, key) }
            let channel = try SSHChannel(connection: connection)
            connection.begin(timeout: 1)
            let result = try channel.execute("quiet")
            XCTAssertEqual(result["result"] as? String, "stdout ✓\nstderr\n")
            return result["code"] as? Int
        }.value
        XCTAssertEqual(code, 17)
    }

    func testHandshakeTimeoutInvalidatesTransport() async throws {
        let fixture = try await SSHTestFixture.configuration()
        let port = fixture["silentPort"] as! Int
        let invalidated = try await Task.detached {
            let cancellation = SSHCancellation()
            let connection = try SSHConnection(cancellation: cancellation)
            let profile = SSHProfile(hostname: "127.0.0.1", port: port, username: "fixture", authType: "password")
            do {
                try connection.connect(profile, timeout: 0.2) { _, _ in XCTFail("Stalled server supplied a key") }
                XCTFail("Stalled handshake succeeded")
            } catch { XCTAssertEqual(error.localizedDescription, "SSH operation timed out") }
            XCTAssertThrowsError(try cancellation.check())
            return !connection.isConnected
        }.value
        XCTAssertTrue(invalidated)
    }

    func testCancellingUnknownHostDismissesPromptAndDoesNotTrustKey() async throws {
        let fixture = try await SSHTestFixture.configuration()
        let store = SSHProfileStore()
        let (id, profile) = try store.save([NSNull(), "localhost", fixture["port"]!, "fixture", "password", "fixture-password"], legacy: false)
        let hosts = SecretStore(namespace: "ssh.knownHosts")
        defer { try? store.remove(id); try? hosts.remove(profile.endpoint) }
        let webView = try await appWebView()
        try await webView.callAsyncJavaScript("""
            window.sshPromptAttempt = new Promise(resolve=>Bridge.exec(()=>resolve({connected:true}),resolve,'Sftp','testProfile',[id,'prompt-test',30000]));
            return true;
            """, arguments: ["id": id], in: nil, contentWorld: .page)
        var prompt: UIAlertController?
        for _ in 0..<150 {
            prompt = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows).compactMap { alert($0.rootViewController) }.first
            if prompt != nil { break }
            try await Task.sleep(for: .milliseconds(20))
        }
        XCTAssertEqual(prompt?.title, "Unknown SSH host")
        XCTAssertTrue(prompt?.message?.contains("SHA256:") == true)
        XCTAssertEqual(prompt?.actions.map(\.title), ["Cancel", "Trust and connect"])
        let cancelled = try await webView.callAsyncJavaScript("""
            await new Promise((resolve,reject)=>Bridge.exec(resolve,reject,'Sftp','cancelConnection',['prompt-test']));
            const result = await window.sshPromptAttempt;
            delete window.sshPromptAttempt;
            return result.code === 'SFTP_CONNECT_CANCELLED';
            """, arguments: [:], in: nil, contentWorld: .page) as? Bool
        XCTAssertEqual(cancelled, true)
        for _ in 0..<100 where prompt?.presentingViewController != nil { try await Task.sleep(for: .milliseconds(20)) }
        XCTAssertNil(prompt?.presentingViewController)
        XCTAssertEqual(try hosts.get(profile.endpoint), "")
    }

    func testInvalidPasswordFailsWithoutCreatingConnection() async throws {
        let fixture = try await SSHTestFixture.configuration()
        let store = SSHProfileStore()
        let (id, profile) = try store.save([NSNull(), "127.0.0.1", fixture["port"]!, "fixture", "password", "wrong-password"], legacy: false)
        defer { try? store.remove(id); try? SecretStore(namespace: "ssh.knownHosts").remove(profile.endpoint) }
        try store.verify(endpoint: profile.endpoint, key: Data(base64Encoded: fixture["hostKey"] as! String)!, algorithm: "ssh-rsa") { _ in true }
        let webView = try await appWebView()
        let result = try await webView.callAsyncJavaScript("""
            const call=(action,args=[])=>new Promise((resolve,reject)=>Bridge.exec(resolve,reject,'Sftp',action,args));
            await call('close');
            try { await call('connectUsingProfile',[id]); throw Error('Wrong password authenticated'); }
            catch(error) { if(error.message === 'Wrong password authenticated') throw error; }
            return await call('isConnected') === 0;
            """, arguments: ["id": id], in: nil, contentWorld: .page) as? Bool
        XCTAssertEqual(result, true)
    }

    private func alert(_ controller: UIViewController?) -> UIAlertController? {
        guard let controller else { return nil }
        if let alert = controller as? UIAlertController { return alert }
        if let presented = alert(controller.presentedViewController) { return presented }
        return controller.children.compactMap { alert($0) }.first
    }
}

enum SSHTestFixture {
    static func configuration() async throws -> [String: Any] {
        let request = URLRequest(url: URL(string: "http://127.0.0.1:22199")!, timeoutInterval: 10)
        do {
            let (data, _) = try await URLSession.shared.data(for: request)
            return try JSONSerialization.jsonObject(with: data) as! [String: Any]
        } catch let error as URLError where error.code == .cannotConnectToHost {
            throw XCTSkip("Start tests/fixtures/ssh/server.py for the local SSH integration tests")
        }
    }
}

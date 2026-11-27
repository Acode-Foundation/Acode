import XCTest
@testable import runner

final class FTPTransportTests: XCTestCase {
    func testFTPSVerifiesCertificateAndEncryptsActiveAndPassiveData() async throws {
        let fixture = try await SSHTestFixture.configuration()
        let certificate = Data((fixture["ftpCertificate"] as! String).utf8)
        try await Task.detached {
            for implicit in [false, true] {
                let port = implicit ? 990 : fixture["ftpsPort"] as! Int
                let route = implicit ? "localhost:990:127.0.0.1:\(fixture["implicitFtpsPort"] as! Int)" : nil
                for mode in ["passive", "active"] {
                    let profile = try FTPProfile(["localhost", port, "fixture", "fixture-password", mode, "ftps"])
                    let client = try FTPClient(profile, certificate: certificate, connectTo: route)
                    try client.connect()
                    XCTAssertEqual(client.directory, "/")
                    XCTAssertTrue(try client.list("/").contains { $0["name"] as? String == ".hidden" })
                    let local = AppFiles.shared.cache.appendingPathComponent(UUID().uuidString)
                    defer { try? FileManager.default.removeItem(at: local) }
                    let data = Data((0..<350003).map { UInt8($0 % 256) })
                    try data.write(to: local)
                    let remote = "/tls-" + UUID().uuidString
                    try client.upload(local.absoluteString, to: remote)
                    try Data().write(to: local)
                    try client.download(remote, to: local.absoluteString)
                    XCTAssertEqual(try Data(contentsOf: local), data)
                    try client.command("DELE " + remote)
                }
            }
        }.value
    }

    func testFTPSRejectsUntrustedCertificateAndWrongHostname() async throws {
        let fixture = try await SSHTestFixture.configuration()
        let certificate = Data((fixture["ftpCertificate"] as! String).utf8)
        try await Task.detached {
            for implicit in [false, true] {
                let port = implicit ? 990 : fixture["ftpsPort"] as! Int
                let route = implicit ? ":990:127.0.0.1:\(fixture["implicitFtpsPort"] as! Int)" : nil
                let untrusted = try FTPClient(FTPProfile(["localhost", port, "fixture", "fixture-password", "passive", "ftps"]), connectTo: route)
                XCTAssertThrowsError(try untrusted.connect()) { error in
                    XCTAssertTrue(error.localizedDescription.lowercased().contains("certificate"), error.localizedDescription)
                }
                let mismatch = try FTPClient(FTPProfile(["127.0.0.1", port, "fixture", "fixture-password", "passive", "ftps"]), certificate: certificate, connectTo: route)
                XCTAssertThrowsError(try mismatch.connect()) { error in
                    XCTAssertTrue(error.localizedDescription.lowercased().contains("certificate"), error.localizedDescription)
                }
            }
        }.value
    }

    func testCancelledHandshakeStopsAndInvalidPasswordFails() async throws {
        let fixture = try await SSHTestFixture.configuration()
        let port = fixture["ftpPort"] as! Int
        let silentPort = fixture["silentPort"] as! Int
        let client = try FTPClient(FTPProfile(["127.0.0.1", silentPort, "fixture", "fixture-password"]))
        let pending = Task.detached { try client.connect() }
        try await Task.sleep(for: .milliseconds(100))
        client.cancellation.cancel()
        do { try await pending.value; XCTFail("Cancelled connection succeeded") }
        catch { XCTAssertEqual(error.localizedDescription, "FTP operation cancelled") }
        try await Task.detached {
            let invalid = try FTPClient(FTPProfile(["127.0.0.1", port, "fixture", "wrong-password"]))
            XCTAssertThrowsError(try invalid.connect())
        }.value
    }
}

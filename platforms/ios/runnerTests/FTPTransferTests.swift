import XCTest
import WebKit
@testable import runner

@MainActor
final class FTPTransferTests: BridgeTestCase {
    func testDisconnectDuringDownloadSettlesAndAllowsReconnect() async throws {
        let fixture = try await SSHTestFixture.configuration()
        for mode in ["passive", "active"] {
            try await disconnectTransfer(port: fixture["ftpPort"] as! Int, mode: mode)
        }
    }

    func testDroppedConnectionsRejectTransfersAndAllowRecovery() async throws {
        let fixture = try await SSHTestFixture.configuration()
        let certificate = Data((fixture["ftpCertificate"] as! String).utf8)
        try await Task.detached {
            for security in ["ftp", "ftps", "implicit"] {
                let port = security == "implicit" ? 990 : fixture[security == "ftp" ? "ftpPort" : "ftpsPort"] as! Int
                let route = security == "implicit" ? "localhost:990:127.0.0.1:\(fixture["implicitFtpsPort"] as! Int)" : nil
                for mode in ["passive", "active"] {
                    let profile = try FTPProfile(["localhost", port, "fixture", "fixture-password", mode, security == "ftp" ? "ftp" : "ftps"])
                    let client = try FTPClient(profile, certificate: certificate, connectTo: route)
                    try client.connect()
                    let local = AppFiles.shared.cache.appendingPathComponent(UUID().uuidString)
                    defer { try? FileManager.default.removeItem(at: local) }
                    XCTAssertThrowsError(try client.download("/broken-transfer.bin", to: local.absoluteString))
                    let partial = try Data(contentsOf: local)
                    XCTAssertGreaterThan(partial.count, 0)
                    XCTAssertLessThan(partial.count, 8_388_608)
                    XCTAssertEqual(partial, Data((0..<partial.count).map { UInt8($0 % 256) }))
                    try client.download("/target.txt", to: local.absoluteString)
                    XCTAssertEqual(try String(contentsOf: local, encoding: .utf8), "target")
                    try Data(repeating: 0xA5, count: 8_388_608).write(to: local)
                    XCTAssertThrowsError(try client.upload(local.absoluteString, to: "/broken-upload.bin"))
                    let size = try client.stat("/broken-upload.bin").size
                    XCTAssertGreaterThan(size, 0)
                    XCTAssertLessThan(size, 8_388_608)
                    let recovered = "/recovered-upload-" + UUID().uuidString
                    let bytes = Data("Recovered upload ✓".utf8)
                    try bytes.write(to: local)
                    try client.upload(local.absoluteString, to: recovered)
                    try Data().write(to: local)
                    try client.download(recovered, to: local.absoluteString)
                    XCTAssertEqual(try Data(contentsOf: local), bytes)
                    try client.command("DELE " + recovered)
                    try client.command("DELE /broken-upload.bin")
                }
            }
        }.value
    }

    private func disconnectTransfer(port: Int, mode: String) async throws {
        let local = AppFiles.shared.cache.appendingPathComponent("interrupted-ftp-" + UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: local) }
        let id = "fixture@127.0.0.1:\(port)"
        let webView = try await editorWebView()
        addTeardownBlock { @MainActor in
            _ = try? await webView.callAsyncJavaScript("""
                await new Promise(resolve=>Bridge.exec(resolve,resolve,'Ftp','disconnect',[id]));
                delete window.interruptedFTPTransfer;
                """, arguments: ["id": id], in: nil, contentWorld: .page)
        }
        _ = try await webView.callAsyncJavaScript("""
            const call=(action,args=[])=>new Promise((resolve,reject)=>Bridge.exec(resolve,reject,'Ftp',action,args));
            await call('disconnect',[id]);
            await call('connect',['127.0.0.1',port,'fixture','fixture-password',mode]);
            window.interruptedFTPTransfer=call('downloadFile',[id,'/slow-transfer.bin',uri]).then(()=>({success:true}),error=>({error}));
            return true;
            """, arguments: ["id": id, "port": port, "mode": mode, "uri": local.absoluteString], in: nil, contentWorld: .page)
        var length: UInt64 = 0
        for _ in 0..<100 {
            length = (try? FileManager.default.attributesOfItem(atPath: local.path)[.size] as? NSNumber)?.uint64Value ?? 0
            if length > 0 { break }
            try await Task.sleep(for: .milliseconds(50))
        }
        XCTAssertGreaterThan(length, 0)
        XCTAssertLessThan(length, 8_388_608)
        let result = try await webView.callAsyncJavaScript("""
            const call=(action,args=[])=>new Promise((resolve,reject)=>Bridge.exec(resolve,reject,'Ftp',action,args));
            let timer;
            try {
                const stopped=await Promise.race([
                    Promise.all([call('disconnect',[id]),window.interruptedFTPTransfer]),
                    new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('Transfer did not stop after disconnect')),5000);})
                ]);
                if(stopped[1].error!=='FTP operation cancelled')throw Error('Interrupted transfer did not report cancellation: '+JSON.stringify(stopped[1]));
                await call('connect',['127.0.0.1',port,'fixture','fixture-password',mode]);
                if(await call('isConnected',[id])!==1)throw Error('Reconnect failed');
                await call('downloadFile',[id,'/target.txt',uri]);
                await call('disconnect',[id]);
                return true;
            } finally {clearTimeout(timer);delete window.interruptedFTPTransfer;}
            """, arguments: ["id": id, "port": port, "mode": mode, "uri": local.absoluteString], in: nil, contentWorld: .page) as? Bool
        XCTAssertEqual(result, true)
        XCTAssertEqual(try String(contentsOf: local, encoding: .utf8), "target")
    }
}

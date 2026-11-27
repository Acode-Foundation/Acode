import XCTest
import WebKit
@testable import runner

@MainActor
final class SSHTransferTests: BridgeTestCase {
    func testDroppedTransfersRejectAndAllowCleanReconnect() async throws {
        let fixture = try await SSHTestFixture.configuration()
        let store = SSHProfileStore()
        let (id, profile) = try store.save([NSNull(), "127.0.0.1", fixture["port"]!, "fixture", "password", "fixture-password"], legacy: false)
        defer { try? store.remove(id); try? SecretStore(namespace: "ssh.knownHosts").remove(profile.endpoint) }
        try store.verify(endpoint: profile.endpoint, key: Data(base64Encoded: fixture["hostKey"] as! String)!, algorithm: "ssh-rsa") { _ in true }
        let local = AppFiles.shared.cache.appendingPathComponent("dropped-sftp-" + UUID().uuidString)
        let upload = AppFiles.shared.cache.appendingPathComponent("upload-sftp-" + UUID().uuidString)
        try Data(repeating: 0xA5, count: 8_388_608).write(to: upload)
        defer {
            try? FileManager.default.removeItem(at: local)
            try? FileManager.default.removeItem(at: upload)
        }
        let webView = try await editorWebView()
        let result = try await webView.callAsyncJavaScript("""
            const call=(action,args=[])=>new Promise((resolve,reject)=>Bridge.exec(resolve,error=>reject(Error(action+' '+(args[0]||'')+': '+JSON.stringify(error))),'Sftp',action,args));
            const interrupted=async request=>{
                let timer;
                try {
                    const outcome=await Promise.race([
                        request.then(()=>({success:true}),error=>({error})),
                        new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('Dropped transfer did not settle')),5000);})
                    ]);
                    if(outcome.success || !outcome.error) throw Error('Dropped transfer reported success');
                    if(await call('isConnected')!==0) throw Error('Dropped connection still reported active');
                } finally {clearTimeout(timer);}
            };
            try {
                await call('close');
                await call('connectUsingProfile',[id]);
                await interrupted(call('getFile',['/broken-sftp-download.bin',local]));
                const fs=acode.require('fsOperation');
                const partialDownload=await fs(local).stat();
                await call('connectUsingProfile',[id]);
                await call('getFile',['/target.txt',local]);
                if(await fs(local).readFile('utf-8')!=='target') throw Error('Download retry retained partial data');
                await interrupted(call('putFile',['/broken-sftp-upload.bin',upload]));
                await call('connectUsingProfile',[id]);
                const partialUpload=await call('stat',['/broken-sftp-upload.bin']);
                await call('putFile',['/broken-sftp-upload.bin',local]);
                await call('getFile',['/broken-sftp-upload.bin',local]);
                if(await fs(local).readFile('utf-8')!=='target') throw Error('Upload retry retained partial data');
                await call('rm',['/broken-sftp-upload.bin',false,false]);
                return {download:partialDownload.length,upload:partialUpload.length};
            } catch(error) {throw Error(error?.message || JSON.stringify(error));}
            finally {await call('close');}
            """, arguments: ["id": id, "local": local.absoluteString, "upload": upload.absoluteString], in: nil, contentWorld: .page) as? [String: Any]
        for key in ["download", "upload"] {
            let size = try XCTUnwrap(result?[key] as? Int)
            XCTAssertGreaterThan(size, 0)
            XCTAssertLessThan(size, 8_388_608)
        }
        XCTAssertEqual(try String(contentsOf: local, encoding: .utf8), "target")
    }

    func testClosingDuringDownloadSettlesTheTransferAndAllowsReconnect() async throws {
        let fixture = try await SSHTestFixture.configuration()
        let store = SSHProfileStore()
        let (id, profile) = try store.save([NSNull(), "127.0.0.1", fixture["port"]!, "fixture", "password", "fixture-password"], legacy: false)
        defer { try? store.remove(id); try? SecretStore(namespace: "ssh.knownHosts").remove(profile.endpoint) }
        try store.verify(endpoint: profile.endpoint, key: Data(base64Encoded: fixture["hostKey"] as! String)!, algorithm: "ssh-rsa") { _ in true }
        let local = AppFiles.shared.cache.appendingPathComponent("interrupted-sftp-" + UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: local) }
        let webView = try await appWebView()
        addTeardownBlock { @MainActor in
            _ = try? await webView.callAsyncJavaScript("""
                await new Promise(resolve=>Bridge.exec(resolve,resolve,'Sftp','close',[]));
                delete window.interruptedTransfer;
                """, arguments: [:], in: nil, contentWorld: .page)
        }
        _ = try await webView.callAsyncJavaScript("""
            const call=(action,args=[])=>new Promise((resolve,reject)=>Bridge.exec(resolve,reject,'Sftp',action,args));
            await call('close');
            await call('connectUsingProfile',[id]);
            window.interruptedTransfer=call('getFile',['/slow-transfer.bin',uri]).then(()=>({success:true}),error=>({error}));
            return true;
            """, arguments: ["id": id, "uri": local.absoluteString], in: nil, contentWorld: .page)
        var length: UInt64 = 0
        for _ in 0..<100 {
            length = (try? FileManager.default.attributesOfItem(atPath: local.path)[.size] as? NSNumber)?.uint64Value ?? 0
            if length > 0 { break }
            try await Task.sleep(for: .milliseconds(50))
        }
        XCTAssertGreaterThan(length, 0)
        XCTAssertLessThan(length, 8_388_608)
        let result = try await webView.callAsyncJavaScript("""
            const call=(action,args=[])=>new Promise((resolve,reject)=>Bridge.exec(resolve,reject,'Sftp',action,args));
            let timer;
            try {
                const stopped=await Promise.race([
                    Promise.all([call('close'),window.interruptedTransfer]),
                    new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('Transfer did not stop after close')),5000);})
                ]);
                if(stopped[1].error?.code!=='SFTP_CONNECT_CANCELLED')throw Error('Interrupted transfer did not report cancellation: '+JSON.stringify(stopped[1]));
                if(await call('isConnected')!==0)throw Error('Closed connection still reported active');
                await call('connectUsingProfile',[id]);
                if(await call('isConnected')!==id)throw Error('Reconnect failed');
                await call('getFile',['/target.txt',uri]);
                return true;
            } finally {clearTimeout(timer);delete window.interruptedTransfer;}
            """, arguments: ["id": id, "uri": local.absoluteString], in: nil, contentWorld: .page) as? Bool
        XCTAssertEqual(result, true)
        XCTAssertEqual(try String(contentsOf: local, encoding: .utf8), "target")
    }
}

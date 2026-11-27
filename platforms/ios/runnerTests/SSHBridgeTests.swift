import XCTest
import WebKit
@testable import runner

@MainActor
final class SSHBridgeTests: BridgeTestCase {
    func testSFTPFilesCommandsProfilesAndCancellation() async throws {
        let fixture = try await SSHTestFixture.configuration()
        let port = fixture["port"] as! Int
        let store = SSHProfileStore()
        let (id, profile) = try store.save([NSNull(), "127.0.0.1", port, "fixture", "password", "fixture-password"], legacy: false)
        let (silentID, _) = try store.save([NSNull(), "127.0.0.1", fixture["silentPort"]!, "fixture", "password", "fixture-password"], legacy: false)
        defer { try? store.remove(id); try? store.remove(silentID); try? SecretStore(namespace: "ssh.knownHosts").remove(profile.endpoint) }
        try store.verify(endpoint: profile.endpoint, key: Data(base64Encoded: fixture["hostKey"] as! String)!, algorithm: "ssh-rsa") { _ in true }
        let webView = try await appWebView()
        let result = try await webView.callAsyncJavaScript("""
            const call = (action,args=[])=>new Promise((resolve,reject)=>Bridge.exec(resolve,error=>reject(Object.assign(new Error(),error,{message:action+': '+JSON.stringify(error)})),'Sftp',action,args));
            const folder = '/acode-' + Date.now();
            const local = Bridge.file.cacheDirectory + 'ssh-fixture.bin';
            try {
                const info = await call('getProfileInfo',[id]);
                if(info.password || info.privateKey || info.profileId !== id) throw Error('Profile leaked or changed');
                if(await call('testProfile',[id,'test',30000]) !== '/') throw Error('Home changed');
                if(await call('isConnected') !== id) throw Error('Connection ID changed');
                await call('mkdir',[folder]);
                const name = folder + '/Acode ✓ 日本語 + #% file.txt';
                await call('createFile',[name,'Acode ✓']);
                try { await call('createFile',[name,'overwrite']); throw Error('Overwrote existing file'); } catch(e) { if(e.message === 'Overwrote existing file') throw e; }
                const entries = await call('lsDir',[folder]);
                if(entries.length !== 1 || !entries[0].isFile || entries[0].length !== 9 || entries[0].url !== name) throw Error('Directory metadata changed ' + JSON.stringify(entries));
                await call('getFile',[name,local]);
                const textEntry = await new Promise((resolve,reject)=>window.resolveLocalFileSystemURL(local,resolve,reject));
                if(await (await fetch(textEntry.toInternalURL())).text() !== 'Acode ✓') throw Error('Text download changed');
                const bytes = new Uint8Array(350003).map((_,i)=>i%256);
                await new Promise((resolve,reject)=>window.resolveLocalFileSystemURL(local,entry=>entry.createWriter(writer=>{writer.onwriteend=resolve;writer.onerror=reject;writer.write(new Blob([bytes]));},reject),reject));
                await call('putFile',[name,local]);
                await call('rename',[name,folder+'/renamed.bin']);
                await call('getFile',[folder+'/renamed.bin',local]);
                const entry = await new Promise((resolve,reject)=>window.resolveLocalFileSystemURL(local,resolve,reject));
                const downloaded = new Uint8Array(await (await fetch(entry.toInternalURL())).arrayBuffer());
                if(downloaded.length !== bytes.length || downloaded.some((b,i)=>b!==i%256)) throw Error('Transfer corrupted');
                if((await call('stat',['/missing'])).exists !== false) throw Error('Missing stat changed');
                try { await call('stat',['/denied']); throw Error('Permission error hidden'); } catch(e) { if(e.message === 'Permission error hidden') throw e; }
                const link = await call('stat',['/relative-link']);
                if(!link.isLink || !link.isFile || link.linkTarget !== 'target.txt') throw Error('Relative link changed');
                const broken = await call('stat',['/broken-link']);
                if(!broken.isLink || broken.isFile || broken.isDirectory) throw Error('Broken link changed');
                const exec = await call('exec',['large']);
                if(exec.code !== 17 || !exec.result.includes('Acode ✓ 日本語') || !exec.result.includes('stderr') || exec.result.length !== ('Acode ✓ 日本語\\n'.repeat(9000)+'stderr\\n').length) throw Error('Command output truncated: '+exec.result.length+'/'+exec.code);
                const request = call('testProfile',[silentID,'cancel-me',30000]).then(()=>{throw Error('Cancelled connection succeeded');},error=>error);
                await new Promise(resolve=>setTimeout(resolve,100));
                await call('cancelConnection',['cancel-me']);
                const cancelled = await request;
                if(cancelled.code !== 'SFTP_CONNECT_CANCELLED' || !cancelled.nonRetryable) throw Error('Cancellation changed');
                await call('rm',[folder,false,true]);
                if((await call('stat',[folder])).exists) throw Error('Recursive remove failed');
                await call('close');
                if(await call('isConnected') !== 0) throw Error('Connection leaked');
                return true;
            } finally {
                await call('close');
                try { const entry=await new Promise((resolve,reject)=>window.resolveLocalFileSystemURL(local,resolve,reject)); await new Promise((resolve,reject)=>entry.remove(resolve,reject)); } catch {}
            }
            """, arguments: ["id": id, "silentID": silentID], in: nil, contentWorld: .page) as? Bool
        XCTAssertEqual(result, true)
    }

    func testEncryptedPrivateKeyShellResizeAndExit() async throws {
        try await shell(privateKey: "privateKey")
    }

    func testEncryptedOpenSSHKeyShellResizeAndExit() async throws {
        try await shell(privateKey: "ed25519Key")
    }

    private func shell(privateKey: String) async throws {
        let fixture = try await SSHTestFixture.configuration()
        let keyURL = AppFiles.shared.cache.appendingPathComponent(UUID().uuidString)
        try Data((fixture[privateKey] as! String).utf8).write(to: keyURL)
        defer { try? FileManager.default.removeItem(at: keyURL) }
        let store = SSHProfileStore()
        let (id, profile) = try store.save([NSNull(), "127.0.0.1", fixture["port"]!, "fixture", "key", "", keyURL.absoluteString, "fixture-passphrase"], legacy: false)
        defer { try? store.remove(id); try? SecretStore(namespace: "ssh.knownHosts").remove(profile.endpoint) }
        try store.verify(endpoint: profile.endpoint, key: Data(base64Encoded: fixture["hostKey"] as! String)!, algorithm: "ssh-rsa") { _ in true }
        let webView = try await appWebView()
        let result = try await webView.callAsyncJavaScript("""
            const call = (action,args=[])=>new Promise((resolve,reject)=>Bridge.exec(resolve,error=>reject(Object.assign(new Error(),error,{message:action+': '+JSON.stringify(error)})),'Sftp',action,args));
            let session, output='';
            let resolveExit, rejectExit;
            const exited = new Promise((resolve,reject)=>{resolveExit=resolve;rejectExit=reject;});
            try {
                session = await new Promise((resolve,reject)=>Bridge.exec(event=>{
                    if(event.type === 'ready') resolve(event.sessionId);
                    if(event.type === 'data') output += event.data;
                    if(event.type === 'error') rejectExit(Error(event.message));
                    if(event.type === 'exit') resolveExit(event.exitCode);
                },reject,'Sftp','openShellUsingProfile',[id,80,24]));
                await call('resizeShell',[session,123,45]);
                await call('writeShell',[session,'size\\n']);
                await call('writeShell',[session,'echo ✓ 日本語\\n']);
                for(let i=0;i<200 && (!output.includes('size:123x45') || !output.includes('echo ✓ 日本語'));i++) await new Promise(resolve=>setTimeout(resolve,20));
                if(!output.includes('size:123x45') || !output.includes('echo ✓ 日本語')) throw Error('Shell output changed '+output);
                await call('writeShell',[session,'exit\\n']);
                const code = await Promise.race([exited,new Promise((_,reject)=>setTimeout(()=>reject(Error('Shell never exited')),5000))]);
                if(code !== 7) throw Error('Exit status changed '+code);
                return true;
            } finally { if(session) await call('closeShell',[session]); }
            """, arguments: ["id": id], in: nil, contentWorld: .page) as? Bool
        XCTAssertEqual(result, true)
    }

}

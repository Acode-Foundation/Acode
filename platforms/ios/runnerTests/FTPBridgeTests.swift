import XCTest
import WebKit
@testable import runner

@MainActor
final class FTPBridgeTests: BridgeTestCase {
    func testPassiveTransfersAndCommands() async throws { try await exercise(mode: "passive") }
    func testActiveTransfersAndCommands() async throws { try await exercise(mode: "active") }

    private func exercise(mode: String) async throws {
        let fixture = try await SSHTestFixture.configuration()
        let webView = try await appWebView()
        let result = try await webView.callAsyncJavaScript("""
            const call=(action,args=[])=>new Promise((resolve,reject)=>Bridge.exec(resolve,error=>reject(Error(action+': '+JSON.stringify(error))),'Ftp',action,args));
            const options=['127.0.0.1',port,'fixture','fixture-password',mode,'ftp','utf8'];
            const id=await call('connect',options);
            const folder='/acode-'+Date.now(), local=Bridge.file.cacheDirectory+'ftp-fixture.bin';
            const check=(value,message)=>{if(!value) throw Error(message);};
            try {
                check(id==='fixture@127.0.0.1:'+port,'Connection ID changed');
                check(await call('isConnected',[id])===1,'Not connected');
                check(await call('getWorkingDirectory',[id])==='/','Wrong home');
                check(await call('getKeepAlive',[id])===300,'Keepalive changed');
                await call('sendNoOp',[id]);
                check((await call('execCommand',[id,'PWD'])).startsWith('257 '),'PWD reply lost');
                check((await call('execCommand',[id,'UNSUPPORTED'])).startsWith('500 '),'Raw error reply lost');
                const root=await call('listDirectory',[id,'/']);
                check(root.some(x=>x.name==='.hidden'),'Hidden file omitted');
                const link=root.find(x=>x.name==='relative-link');
                check(link?.isLink && link.isFile && link.url==='/target.txt' && link.link==='target.txt','Relative link changed '+JSON.stringify(link));
                const broken=root.find(x=>x.name==='broken-link');
                check(broken?.isLink && !broken.isFile && !broken.isDirectory && broken.url==='/broken-link','Broken link changed');
                check((await call('listDirectory',[id,'/empty'])).length===0,'Empty listing failed');
                check((await call('getStat',[id,'/empty'])).isDirectory,'Empty directory stat failed');
                check((await call('getStat',[id,'/'])).isDirectory,'Root stat failed');
                check((await call('getStat',[id,'/relative-link'])).isLink,'Stat lost symbolic link');
                check(await call('exists',[id,'/missing'])===0,'Missing file exists');
                await call('createDirectory',[id,folder]);
                await call('changeDirectory',[id,folder]);
                check(await call('getWorkingDirectory',[id])===folder,'CWD lost');
                check(await call('connect',options)===id,'Reused connection changed ID');
                check(await call('getWorkingDirectory',[id])===folder,'Reused connection lost CWD');
                check((await call('execCommand',[id,'PWD'])).includes(folder),'Native CWD lost');
                const name='Acode ✓ 日本語 + #% file.txt';
                await call('createFile',[id,name]);
                const entries=await call('listDirectory',[id,folder]);
                check(entries.length===1 && entries[0].name===name && entries[0].length===0 && entries[0].isFile && entries[0].lastModified>0,'Listing changed '+JSON.stringify(entries));
                const bytes=new Uint8Array(350003).map((_,i)=>i%256);
                const cache=await new Promise((resolve,reject)=>window.resolveLocalFileSystemURL(Bridge.file.cacheDirectory,resolve,reject));
                const entry=await new Promise((resolve,reject)=>cache.getFile('ftp-fixture.bin',{create:true},resolve,reject));
                await new Promise((resolve,reject)=>entry.createWriter(writer=>{writer.onwriteend=resolve;writer.onerror=reject;writer.write(new Blob([bytes]));},reject));
                await call('uploadFile',[id,local,name]);
                const stat=await call('getStat',[id,name]);
                check(stat.length===bytes.length && stat.isFile && stat.canRead && stat.canWrite && stat.lastModified>0,'Stat changed '+JSON.stringify(stat));
                check(await call('rename',[id,name,folder+'/renamed.bin'])===folder+'/renamed.bin','Rename reply changed');
                await call('downloadFile',[id,'renamed.bin',local]);
                const downloaded=new Uint8Array(await (await fetch(entry.toInternalURL())).arrayBuffer());
                check(downloaded.length===bytes.length && downloaded.every((b,i)=>b===i%256),'Binary transfer corrupted');
                await call('changeToParentDirectory',[id]);
                check(await call('getWorkingDirectory',[id])==='/','Parent directory lost');
                await call('createDirectory',[id,folder+'/nested']);
                await call('createFile',[id,folder+'/nested/child']);
                await call('deleteFile',[id,folder+'/renamed.bin']);
                await call('deleteDirectory',[id,folder]);
                check(await call('exists',[id,folder])===0,'Recursive deletion failed');
                try { await call('createDirectory',[id,'/bad\\r\\nDELE /target.txt']); throw Error('Command injection accepted'); }
                catch(error) { if(error.message==='Command injection accepted') throw error; }
                check(await call('exists',[id,'/target.txt'])===1,'Command injection deleted target');
                await call('disconnect',[id]);
                await call('connect',options);
                check(await call('isConnected',[id])===1,'Reconnect failed');
                return true;
            } finally {
                await call('disconnect',[id]);
                try { const entry=await new Promise((resolve,reject)=>window.resolveLocalFileSystemURL(local,resolve,reject)); await new Promise((resolve,reject)=>entry.remove(resolve,reject)); } catch {}
            }
            """, arguments: ["port": fixture["ftpPort"]!, "mode": mode], in: nil, contentWorld: .page) as? Bool
        XCTAssertEqual(result, true)
    }
}

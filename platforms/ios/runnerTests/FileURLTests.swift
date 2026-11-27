import XCTest
import WebKit
@testable import runner

@MainActor
final class FileURLTests: BridgeTestCase {
    func testReservedNamesRemainPathsInFileMetadataAndWebViewFetch() async throws {
        let webView = try await editorWebView()
        let result = try await webView.callAsyncJavaScript("""
            const call=(action,args)=>new Promise((resolve,reject)=>Bridge.exec(resolve,error=>reject(Error(action+': '+JSON.stringify(error))),'File',action,args));
            const folder=await call('getDirectory',[Bridge.file.cacheDirectory,'url # ? %3F 日本語 '+Date.now(),{create:true,exclusive:true}]);
            const bytes=new Uint8Array([0,127,128,159,255]);
            const names=['plain.bin','hash # 50% 日本語.bin','question ?.bin','literal %3F %23.bin'];
            try {
                for(const name of names) {
                    const entry=await call('getFile',[folder.nativeURL,name,{create:true,exclusive:true}]);
                    await call('write',[entry.nativeURL,bytes.buffer,0,true]);
                    const file=await new Promise((resolve,reject)=>resolveLocalFileSystemURI(entry.nativeURL,resolve,error=>reject(Error('resolve '+entry.nativeURL+': '+JSON.stringify(error)))));
                    const url=file.toInternalURL();
                    if(new URL(url).search||new URL(url).hash)throw Error('Filename became query or fragment: '+url);
                    const metadata=await new Promise((resolve,reject)=>file.file(resolve,reject));
                    if(metadata.name!==name||metadata.size!==bytes.length)throw Error('Metadata mismatch: '+name);
                    const response=await fetch(url);
                    if(!response.ok)throw Error('File response: '+response.status+' '+name);
                    const read=new Uint8Array(await response.arrayBuffer());
                    if(read.join(',')!==bytes.join(','))throw Error('File bytes changed: '+name);
                }
                return true;
            } finally { await call('removeRecursively',[folder.nativeURL]); }
            """, arguments: [:], in: nil, contentWorld: .page) as? Bool
        XCTAssertEqual(result, true)
    }
}

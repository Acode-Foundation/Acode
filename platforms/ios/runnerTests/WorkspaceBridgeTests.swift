import XCTest
import WebKit
@testable import runner

@MainActor
final class WorkspaceBridgeTests: BridgeTestCase {
    func testPublicIndexAPIStreamsUpdatesSearchDirtyAndClear() async throws {
        let root = AppFiles.shared.cache.appendingPathComponent("index-bridge-" + UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
        defer { try? FileManager.default.removeItem(at: root) }
        let file = root.appendingPathComponent("Acode ✓ # %.txt")
        try Data("😀 needle\nsecond needle".utf8).write(to: file)
        let webView = try await appWebView()
        let result = try await webView.callAsyncJavaScript("""
            const index=acode.require('fileIndex');
            const events=[];
            const unsubscribe=index.subscribe(event=>events.push(event));
            const call=(action,args=[])=>new Promise((resolve,reject)=>Bridge.exec(resolve,reject,'SDcard',action,args));
            try {
                if(!index.supports(root)||index.supports('content://provider/root')||index.supports('sftp://remote/root')) throw Error('Provider routing changed');
                const scan=index.scan({url:root,name:'Fixture'},{indexContent:true});
                const done=await scan;
                if(done.type!=='done'||done.files!==1||done.dirs!==0||!events.some(event=>event.type==='status')) throw Error('Scan events changed');
                const entry=await index.get(file);
                if(entry.name!=='Acode ✓ # %.txt'||entry.path!=='Fixture/Acode ✓ # %.txt'||entry.url!==entry.uri||entry.parent!==root) throw Error('Entry contract changed '+JSON.stringify(entry));
                const results=[];
                const search=index.search({roots:[root],search:'needle',batchResults:true,useIndex:true},event=>results.push(event));
                if((await search.result).type!=='done-searching') throw Error('Search never finished');
                const matches=results.filter(event=>event.type==='search-results').flatMap(event=>event.data).flatMap(result=>result.matches);
                if(matches.length!==2||matches[0].position.start.column!==3||matches[1].position.start.row!==1) throw Error('Search positions changed');
                await call('writeText',[file,'updated', 'UTF-8']);
                await index.markDirty([file]);
                const fresh=[];
                await index.search({roots:[root],search:'updated',useIndex:true},event=>fresh.push(event)).result;
                if(!fresh.some(event=>event.type==='search-results')) throw Error('Dirty content remained cached');
                const renamed=await call('rename',[file,'renamed.txt']);
                await index.update(root,{removed:[file],added:[{url:renamed,parentUrl:root}]});
                if(await index.get(file)||!(await index.get(renamed))) throw Error('Incremental update failed');
                const replacements=[];
                await index.search({roots:[root],search:'updated',replace:'$literal',mode:'replace'},event=>replacements.push(event)).result;
                if(replacements.find(event=>event.type==='replace-result')?.text!=='$literal') throw Error('Replace event changed');
                if(await call('readAsText',[renamed,'UTF-8'])!=='updated') throw Error('Native replacement unexpectedly wrote file');
                const stalled=[];
                const pending=index.search({roots:[root],search:'(a+)+$',options:{regExp:true},overlays:{[renamed]:'a'.repeat(100000)+'!'}},event=>stalled.push(event));
                const outcome=pending.result.then(()=>null,error=>error);
                await new Promise(resolve=>setTimeout(resolve,100));
                await pending.cancel();
                const error=await outcome;
                if(!error?.message.includes('cancelled')||!stalled.some(event=>event.type==='error')) throw Error('Search cancellation did not settle');
                await index.clear([root]);
                if((await index.query({roots:[root]})).entries.length) throw Error('Clear retained workspace');
                return true;
            } finally {unsubscribe();await index.clear([root]);}
            """, arguments: ["root": root.absoluteString, "file": file.absoluteString], in: nil, contentWorld: .page) as? Bool
        XCTAssertEqual(result, true)
    }
}

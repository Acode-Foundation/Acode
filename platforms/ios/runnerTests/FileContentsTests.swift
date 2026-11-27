import XCTest
import WebKit
@testable import runner

@MainActor
final class FileContentsTests: BridgeTestCase {
    func testNativeReadRangesAndBinaryRepresentationsMatchBytes() async throws {
        let app = try await editorWebView()
        let file = AppFiles.shared.cache.appendingPathComponent("ios-read-ranges-" + UUID().uuidString + ".bin")
        try Data((0..<768).map { UInt8($0 % 256) }).write(to: file)
        defer { try? FileManager.default.removeItem(at: file) }
        let result = try await app.callAsyncJavaScript("""
            const call=(action,args)=>new Promise((resolve,reject)=>Bridge.exec(resolve,error=>reject(Error(action+': '+JSON.stringify(error))),'File',action,args));
            for(const [start,end] of [[0,-1],[3,-1],[3,9],[250,2147483647],[300,100],[900,1000]]) {
                const expected=Array.from({length:768},(_,index)=>index%256).slice(start,end<0?768:Math.max(start,end));
                for(const action of ['readAsArrayBuffer','readAsBinaryString','readAsDataURL']) {
                    const value=await call(action,[uri,start,end]);
                    const bytes=action==='readAsArrayBuffer'?[...new Uint8Array(value)]:Array.from(action==='readAsDataURL'?atob(value.split(',')[1]):value,char=>char.charCodeAt(0));
                    if(bytes.join(',')!==expected.join(','))throw Error(action+' range '+start+','+end+' changed bytes: '+bytes.length);
                }
            }
            await call('write',[uri,'plain text',0,false]);
            if(await call('readAsText',[uri,'UTF-8',6,-1])!=='text')throw Error('Open-ended text read failed');
            return true;
            """, arguments: ["uri": file.absoluteString], in: nil, contentWorld: .page) as? Bool
        XCTAssertEqual(result, true)
    }

    func testPublicBinaryReadersPreserveSlicesAcrossNativeChunks() async throws {
        let app = try await editorWebView()
        let file = AppFiles.shared.cache.appendingPathComponent("ios-read-chunks-" + UUID().uuidString + ".bin")
        let count = 524_291
        try Data((0..<count).map { UInt8($0 % 256) }).write(to: file)
        defer { try? FileManager.default.removeItem(at: file) }
        let result = try await app.callAsyncJavaScript("""
            const entry=await new Promise((resolve,reject)=>resolveLocalFileSystemURI(uri,resolve,reject));
            const file=await new Promise((resolve,reject)=>entry.file(resolve,reject));
            for(const action of ['readAsArrayBuffer','readAsBinaryString','readAsDataURL']) {
                const reader=new FileReader();
                const value=await new Promise((resolve,reject)=>{
                    reader.onload=()=>resolve(reader.result);
                    reader.onerror=()=>reject(Error(action+': '+reader.error?.code));
                    reader[action](file.slice(1,-1));
                });
                const bytes=action==='readAsArrayBuffer'?new Uint8Array(value):Array.from(action==='readAsDataURL'?atob(value.split(',')[1]):value,char=>char.charCodeAt(0));
                if(bytes.length!==count-2||bytes.some((byte,index)=>byte!==(index+1)%256))throw Error(action+' changed chunked bytes');
                if(reader.readyState!==FileReader.DONE)throw Error('Reader did not finish');
            }
            return true;
            """, arguments: ["uri": file.absoluteString, "count": count], in: nil, contentWorld: .page) as? Bool
        XCTAssertEqual(result, true)
    }

    func testNegativeTruncateRejectsWithoutErasingTheFileAndWriterRecovers() async throws {
        let app = try await editorWebView()
        let file = AppFiles.shared.cache.appendingPathComponent("ios-truncate-" + UUID().uuidString + ".txt")
        try Data("retain".utf8).write(to: file)
        defer { try? FileManager.default.removeItem(at: file) }
        let result = try await app.callAsyncJavaScript("""
            const entry=await new Promise((resolve,reject)=>resolveLocalFileSystemURI(uri,resolve,reject));
            const writer=await new Promise((resolve,reject)=>entry.createWriter(resolve,reject));
            const events=[];
            writer.onwritestart=()=>events.push('start');writer.onwrite=()=>events.push('write');writer.onerror=()=>events.push('error');
            await new Promise(resolve=>{writer.onwriteend=resolve;writer.truncate(-1);});
            if(writer.error?.code!==1000||events.join(',')!=='start,error'||writer.length!==6)throw Error('Negative truncate did not reject safely: '+JSON.stringify({events,error:writer.error,length:writer.length}));
            const text=await new Promise((resolve,reject)=>Bridge.exec(resolve,reject,'File','readAsText',[uri,'UTF-8',0,99]));
            if(text!=='retain')throw Error('Negative truncate erased contents');
            await new Promise((resolve,reject)=>{writer.onwriteend=resolve;writer.onerror=reject;writer.truncate(3);});
            if(writer.length!==3||writer.readyState!==FileWriter.DONE)throw Error('Writer did not recover');
            return true;
            """, arguments: ["uri": file.absoluteString], in: nil, contentWorld: .page) as? Bool
        XCTAssertEqual(result, true)
        XCTAssertEqual(try String(contentsOf: file, encoding: .utf8), "ret")
    }

    func testWriteOffsetsClampAtEndAndTruncationDoesNotGrowTheFile() async throws {
        let app = try await editorWebView()
        let file = AppFiles.shared.cache.appendingPathComponent("ios-write-offsets-" + UUID().uuidString + ".txt")
        try Data("abc".utf8).write(to: file)
        defer { try? FileManager.default.removeItem(at: file) }
        let result = try await app.callAsyncJavaScript("""
            const call=(action,args)=>new Promise((resolve,reject)=>Bridge.exec(resolve,error=>reject(Error(action+': '+JSON.stringify(error))),'File',action,args));
            if(await call('write',[uri,'Z',100,false])!==1)throw Error('Write count changed');
            if(await call('readAsText',[uri,'UTF-8',0,999])!=='abcZ')throw Error('Write added a gap beyond EOF');
            if(await call('truncate',[uri,99])!==4)throw Error('Truncate grew the file');
            await call('write',[uri,'X',1,false]);
            if(await call('readAsText',[uri,'UTF-8',0,999])!=='aX')throw Error('Write retained the old tail');
            return true;
            """, arguments: ["uri": file.absoluteString], in: nil, contentWorld: .page) as? Bool
        XCTAssertEqual(result, true)
        XCTAssertEqual(try String(contentsOf: file, encoding: .utf8), "aX")
    }
}

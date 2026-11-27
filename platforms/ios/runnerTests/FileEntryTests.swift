import XCTest
import WebKit
@testable import runner

@MainActor
final class FileEntryTests: BridgeTestCase {
    func testFilesystemRequestsCheckCapacityAndRootsReturnThemselvesAsParent() async throws {
        let app = try await editorWebView()
        let result = try await app.callAsyncJavaScript("""
            const roots=[];
            for(const type of [0,1]) {
                roots.push((await new Promise((resolve,reject)=>requestFileSystem(type,1,resolve,reject))).root);
                const code=await new Promise(resolve=>requestFileSystem(type,Number.MAX_SAFE_INTEGER,()=>resolve(null),error=>resolve(error.code)));
                if(code!==FileError.QUOTA_EXCEEDED_ERR)throw Error('Filesystem capacity request was ignored: '+code);
            }
            for(const key of ['applicationDirectory','dataDirectory','cacheDirectory']) roots.push(await new Promise((resolve,reject)=>resolveLocalFileSystemURI(Bridge.file[key],resolve,reject)));
            for(const root of roots) {
                const parent=await new Promise((resolve,reject)=>root.getParent(resolve,error=>reject(Error(root.filesystem.name+': '+error.code))));
                if(parent.fullPath!=='/'||parent.nativeURL!==root.nativeURL||!parent.isDirectory)throw Error('Filesystem root escaped to a parent: '+root.filesystem.name);
            }
            return true;
            """, arguments: [:], in: nil, contentWorld: .page) as? Bool
        XCTAssertEqual(result, true)
    }

    func testAbsoluteAndRelativeChildPathsStayWithinTheirFilesystem() async throws {
        let app = try await editorWebView()
        let directory = AppFiles.shared.cache.appendingPathComponent("ios-entry-paths-" + UUID().uuidString)
        let nested = directory.appendingPathComponent("nested")
        let file = directory.appendingPathComponent("target # ? 日本語.txt")
        try FileManager.default.createDirectory(at: nested, withIntermediateDirectories: true)
        try Data("path content".utf8).write(to: file)
        defer { try? FileManager.default.removeItem(at: directory) }
        let result = try await app.callAsyncJavaScript("""
            const parent=await new Promise((resolve,reject)=>resolveLocalFileSystemURI(uri,resolve,reject));
            const get=(entry,action,path)=>new Promise((resolve,reject)=>entry[action](path,{},resolve,error=>reject(Error(action+' '+path+': '+error.code))));
            for(const path of ['/'+fixture+'/'+name,'../'+name,'./../'+name]) {
                const entry=await get(parent,'getFile',path);
                if(entry.name!==name||entry.nativeURL!==expected)throw Error('Wrong file entry: '+path);
                if(await fetch(entry.toInternalURL()).then(response=>response.text())!=='path content')throw Error('Wrong internal URL: '+path);
            }
            const root=await get(parent,'getDirectory','/');
            for(const path of ['..','../../','/../']) {
                const entry=await get(root,'getDirectory',path);
                if(entry.fullPath!=='/'||entry.nativeURL!==root.nativeURL)throw Error('Parent traversal escaped the filesystem: '+path);
            }
            const current=await get(parent,'getDirectory','.');
            if(current.nativeURL!==parent.nativeURL)throw Error('Current directory changed');
            return true;
            """, arguments: ["uri": nested.absoluteString, "fixture": directory.lastPathComponent, "name": file.lastPathComponent, "expected": file.absoluteString], in: nil, contentWorld: .page) as? Bool
        XCTAssertEqual(result, true)
    }

    func testCreationFlagsTypeChecksAndInvalidNamesPreserveExistingFiles() async throws {
        let app = try await editorWebView()
        let directory = AppFiles.shared.cache.appendingPathComponent("ios-entry-flags-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let file = directory.appendingPathComponent("retain.txt")
        try Data("retain contents".utf8).write(to: file)
        defer { try? FileManager.default.removeItem(at: directory) }
        let result = try await app.callAsyncJavaScript("""
            const parent=await new Promise((resolve,reject)=>resolveLocalFileSystemURI(uri,resolve,reject));
            const get=(action,path,options)=>new Promise((resolve,reject)=>parent[action](path,options,resolve,reject));
            for(const [action,path,options,code] of [
                ['getFile','retain.txt',{create:true,exclusive:true},12],
                ['getDirectory','retain.txt',{},11],
                ['getFile','.',{},11],
                ['getFile','missing.txt',{},1],
                ['getFile','invalid:name.txt',{create:true},5]
            ]) {
                const error=await get(action,path,options).then(()=>null,error=>error.code);
                if(error!==code)throw Error(action+' '+path+': expected '+code+', received '+error);
            }
            const file=await get('getFile','retain.txt',{create:false,exclusive:true});
            for(const action of ['copyTo','moveTo']) {
                const code=await new Promise(resolve=>file[action](parent,'invalid:name.txt',()=>resolve(null),error=>resolve(error.code)));
                if(code!==5)throw Error(action+' accepted an invalid name: '+code);
            }
            await get('getFile','created.txt',{create:true,exclusive:true});
            await get('getDirectory','created-folder',{create:true,exclusive:true});
            return true;
            """, arguments: ["uri": directory.absoluteString], in: nil, contentWorld: .page) as? Bool
        XCTAssertEqual(result, true)
        XCTAssertEqual(try String(contentsOf: file, encoding: .utf8), "retain contents")
        XCTAssertEqual(Set(try FileManager.default.contentsOfDirectory(atPath: directory.path)), ["retain.txt", "created.txt", "created-folder"])
    }
}

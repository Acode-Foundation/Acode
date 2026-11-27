import XCTest
import WebKit
@testable import runner

@MainActor
final class FileTransferTests: BridgeTestCase {
    func testFileEntriesReplaceExistingFilesAndEmptyDirectories() async throws {
        let app = try await editorWebView()
        let manager = FileManager.default
        let root = AppFiles.shared.cache.appendingPathComponent("ios-transfer-" + UUID().uuidString)
        try manager.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? manager.removeItem(at: root) }
        let bytes = Data((0..<2_000_000).map { UInt8($0 % 256) })
        for action in ["copyTo", "moveTo"] {
            for directory in [false, true] {
                let container = root.appendingPathComponent(action + (directory ? "-directory" : "-file"))
                let source = container.appendingPathComponent("source/entry # 日本語")
                let destination = container.appendingPathComponent("destination", isDirectory: true)
                let target = destination.appendingPathComponent(source.lastPathComponent)
                try manager.createDirectory(at: source.deletingLastPathComponent(), withIntermediateDirectories: true)
                try manager.createDirectory(at: destination, withIntermediateDirectories: true)
                if directory {
                    try manager.createDirectory(at: source.appendingPathComponent("empty"), withIntermediateDirectories: true)
                    try bytes.write(to: source.appendingPathComponent("bytes.bin"))
                    try manager.createDirectory(at: target, withIntermediateDirectories: false)
                } else {
                    try bytes.write(to: source)
                    try Data("replace old contents".utf8).write(to: target)
                }
                let uri = try await app.callAsyncJavaScript("""
                    let watch,timer;
                    const changed=action==='moveTo'?new Promise((resolve,reject)=>{
                        watch=sdcard.watchFile(nativeSource,()=>resolve(),reject);
                        timer=setTimeout(()=>reject(Error('Move did not notify the file watcher')),5000);
                    }):Promise.resolve();
                    try {
                        const resolve=uri=>new Promise((resolve,reject)=>resolveLocalFileSystemURI(uri,resolve,reject));
                        const entry=await resolve(nativeSource), parent=await resolve(destination);
                        const result=await new Promise((resolve,reject)=>entry[action](parent,entry.name,resolve,reject));
                        if(result.isDirectory!==directory)throw Error('Transfer result type changed');
                        await changed;return result.nativeURL;
                    }
                    catch(error){throw Error(action+': '+JSON.stringify(error)+' '+error?.message);}
                    finally{clearTimeout(timer);watch?.unwatch();}
                    """, arguments: ["nativeSource": source.absoluteString, "destination": destination.absoluteString, "action": action, "directory": directory], in: nil, contentWorld: .page) as? String
                XCTAssertEqual(URL(string: try XCTUnwrap(uri))?.path, target.path)
                XCTAssertEqual(try Data(contentsOf: directory ? target.appendingPathComponent("bytes.bin") : target), bytes)
                if directory { XCTAssertEqual(try manager.contentsOfDirectory(atPath: target.appendingPathComponent("empty").path), []) }
                XCTAssertEqual(manager.fileExists(atPath: source.path), action == "copyTo")
                XCTAssertEqual(try manager.contentsOfDirectory(atPath: destination.path), [source.lastPathComponent])
            }
        }
    }

    func testRejectedTransfersPreserveSourceAndDestinationContents() async throws {
        let app = try await editorWebView()
        let files = AppFiles.shared
        let root = files.cache.appendingPathComponent("ios-transfer-failure-" + UUID().uuidString)
        let source = root.appendingPathComponent("source")
        let target = root.appendingPathComponent("target")
        try files.manager.createDirectory(at: source, withIntermediateDirectories: true)
        try files.manager.createDirectory(at: target, withIntermediateDirectories: true)
        defer { try? files.manager.removeItem(at: root) }
        let sourceFile = source.appendingPathComponent("retain.txt")
        let targetFile = target.appendingPathComponent("retain.txt")
        try Data("source retained".utf8).write(to: sourceFile)
        try Data("target retained".utf8).write(to: targetFile)
        _ = try await app.callAsyncJavaScript("""
            const reject=async(action,source,parent,name,code)=>{
                const error=await new Promise(resolve=>Bridge.exec(()=>resolve(null),resolve,'File',action,[source,parent,name]));
                if(error!==code)throw Error(action+' '+name+': expected '+code+', received '+error);
            };
            for(const action of ['copyTo','moveTo']) {
                await reject(action,file,source,'retain.txt',9);
                await reject(action,source,source,'nested',9);
                await reject(action,source,root,'target',9);
                await reject(action,file,root,'target',9);
                await reject(action,source,target,'retain.txt',9);
                await reject(action,missing,target,'retain.txt',1);
            }
            return true;
            """, arguments: ["root": root.absoluteString, "source": source.absoluteString, "target": target.absoluteString, "file": sourceFile.absoluteString, "missing": root.appendingPathComponent("missing").absoluteString], in: nil, contentWorld: .page)
        XCTAssertEqual(try String(contentsOf: sourceFile, encoding: .utf8), "source retained")
        XCTAssertEqual(try String(contentsOf: targetFile, encoding: .utf8), "target retained")
        XCTAssertEqual(try files.manager.contentsOfDirectory(atPath: source.path), ["retain.txt"])
        XCTAssertEqual(try files.manager.contentsOfDirectory(atPath: target.path), ["retain.txt"])
    }

    func testUnreadableSourceDoesNotTruncateAnExistingDestination() async throws {
        let app = try await editorWebView()
        let files = AppFiles.shared
        let root = files.cache.appendingPathComponent("ios-transfer-permissions-" + UUID().uuidString)
        try files.manager.createDirectory(at: root, withIntermediateDirectories: true)
        let source = root.appendingPathComponent("source")
        let target = root.appendingPathComponent("target")
        try Data("source retained".utf8).write(to: source)
        try Data("target retained".utf8).write(to: target)
        defer {
            try? files.manager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: source.path)
            try? files.manager.removeItem(at: root)
        }
        try files.manager.setAttributes([.posixPermissions: 0], ofItemAtPath: source.path)
        let error = try await app.callAsyncJavaScript("""
            return await new Promise(resolve=>Bridge.exec(()=>resolve(null),resolve,'File','copyTo',[source,root,'target']));
            """, arguments: ["root": root.absoluteString, "source": source.absoluteString], in: nil, contentWorld: .page) as? Int
        XCTAssertEqual(error, 2)
        XCTAssertEqual(try String(contentsOf: target, encoding: .utf8), "target retained")
        try files.manager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: source.path)
        XCTAssertEqual(try String(contentsOf: source, encoding: .utf8), "source retained")
        XCTAssertEqual(Set(try files.manager.contentsOfDirectory(atPath: root.path)), ["source", "target"])
    }
}

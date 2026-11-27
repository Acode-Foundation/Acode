import XCTest
import WebKit
@testable import runner

@MainActor
final class FileSymlinkTests: BridgeTestCase {
    func testRemovingLinksThroughNativeAndPublicFileAPIsPreservesTargets() async throws {
        let app = try await editorWebView()
        let files = AppFiles.shared
        let directory = files.cache.appendingPathComponent("ios-links-" + UUID().uuidString)
        try files.manager.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? files.manager.removeItem(at: directory) }
        let target = directory.appendingPathComponent("target.txt")
        let link = directory.appendingPathComponent("alias # 日本語.txt")
        let bytes = Data("retain target contents".utf8)
        for route in ["native", "resolve", "child", "listing"] {
            try bytes.write(to: target)
            try files.manager.createSymbolicLink(atPath: link.path, withDestinationPath: target.lastPathComponent)
            _ = try await app.callAsyncJavaScript("""
                const call=(action,args)=>new Promise((resolve,reject)=>Bridge.exec(resolve,error=>reject(Error(action+': '+JSON.stringify(error))),'File',action,args));
                if(route==='native') return await call('remove',[uri]);
                const resolve=uri=>new Promise((resolve,reject)=>resolveLocalFileSystemURI(uri,resolve,reject));
                const folder=await resolve(root);
                let entry;
                if(route==='resolve') entry=await resolve(uri);
                else if(route==='child') entry=await new Promise((resolve,reject)=>folder.getFile(name,{},resolve,reject));
                else entry=(await new Promise((resolve,reject)=>folder.createReader().readEntries(resolve,reject))).find(entry=>entry.name===name);
                if(!entry||entry.name!==name||entry.nativeURL!==uri)throw Error('Link identity changed: '+route);
                if(!decodeURIComponent(new URL(entry.toInternalURL()).pathname).endsWith('/'+name))throw Error('Internal URL points at target: '+route);
                const metadata=await new Promise((resolve,reject)=>entry.file(resolve,reject));
                if(metadata.name!==name||metadata.size!==22)throw Error('Link metadata changed: '+route);
                const text=await fetch(entry.toInternalURL()).then(response=>response.text());
                if(text!=='retain target contents')throw Error('Link read failed: '+route);
                await new Promise((resolve,reject)=>entry.remove(resolve,reject));
                return true;
                """, arguments: ["route": route, "root": directory.absoluteString, "uri": link.absoluteString, "name": link.lastPathComponent], in: nil, contentWorld: .page)
            XCTAssertEqual(try Data(contentsOf: target), bytes, route)
            XCTAssertThrowsError(try files.manager.destinationOfSymbolicLink(atPath: link.path), route)
        }
    }

    func testMovingAndRecursivelyRemovingLinksLeaveTargetsIntact() async throws {
        let app = try await editorWebView()
        let files = AppFiles.shared
        let directory = files.cache.appendingPathComponent("ios-link-moves-" + UUID().uuidString)
        let target = directory.appendingPathComponent("target", isDirectory: true)
        try files.manager.createDirectory(at: target, withIntermediateDirectories: true)
        defer { try? files.manager.removeItem(at: directory) }
        let content = target.appendingPathComponent("retain.txt")
        try Data("retain directory contents".utf8).write(to: content)
        let link = directory.appendingPathComponent("alias")
        try files.manager.createSymbolicLink(atPath: link.path, withDestinationPath: target.lastPathComponent)
        let moved = directory.appendingPathComponent("renamed")
        _ = try await app.callAsyncJavaScript("""
            const call=(action,args)=>new Promise((resolve,reject)=>Bridge.exec(resolve,error=>reject(Error(action+': '+JSON.stringify(error))),'File',action,args));
            const entry=await call('moveTo',[uri,root,'renamed']);
            if(entry.name!=='renamed')throw Error('Moved link name changed');
            return true;
            """, arguments: ["root": directory.absoluteString, "uri": link.absoluteString], in: nil, contentWorld: .page)
        XCTAssertEqual(try files.manager.destinationOfSymbolicLink(atPath: moved.path), target.lastPathComponent)
        XCTAssertEqual(try String(contentsOf: content, encoding: .utf8), "retain directory contents")
        let existing = directory.appendingPathComponent("existing")
        try files.manager.createSymbolicLink(atPath: existing.path, withDestinationPath: target.lastPathComponent)
        _ = try await app.callAsyncJavaScript("""
            for(const action of ['moveTo','copyTo']) {
                const error=await new Promise(resolve=>Bridge.exec(()=>resolve(null),resolve,'File',action,[uri,root,'existing']));
                if(error!==12)throw Error('Destination link was not protected: '+action+' '+error);
            }
            return true;
            """, arguments: ["root": directory.absoluteString, "uri": moved.absoluteString], in: nil, contentWorld: .page)
        XCTAssertEqual(try files.manager.destinationOfSymbolicLink(atPath: moved.path), target.lastPathComponent)
        XCTAssertEqual(try files.manager.destinationOfSymbolicLink(atPath: existing.path), target.lastPathComponent)
        _ = try await app.callAsyncJavaScript("""
            return await new Promise((resolve,reject)=>Bridge.exec(resolve,reject,'File','removeRecursively',[uri]));
            """, arguments: ["uri": moved.absoluteString], in: nil, contentWorld: .page)
        XCTAssertThrowsError(try files.manager.destinationOfSymbolicLink(atPath: moved.path))
        XCTAssertEqual(try String(contentsOf: content, encoding: .utf8), "retain directory contents")
        let destination = directory.appendingPathComponent("destination", isDirectory: true)
        try files.manager.createDirectory(at: destination, withIntermediateDirectories: false)
        _ = try await app.callAsyncJavaScript("""
            const call=(action,args)=>new Promise((resolve,reject)=>Bridge.exec(resolve,error=>reject(Error(action+': '+JSON.stringify(error))),'File',action,args));
            const entry=await call('moveTo',[uri,root,'relative-link']);
            if(entry.name!=='relative-link')throw Error('Moved relative link name changed');
            const listed=await call('readEntries',[root]);
            if(listed.length!==1||listed[0].name!=='relative-link')throw Error('Dangling link disappeared from listing');
            await call('remove',[entry.nativeURL]);
            return true;
            """, arguments: ["root": destination.absoluteString, "uri": existing.absoluteString], in: nil, contentWorld: .page)
        XCTAssertEqual(try files.manager.contentsOfDirectory(atPath: destination.path), [])
        XCTAssertEqual(try String(contentsOf: content, encoding: .utf8), "retain directory contents")
    }

    func testUnauthorizedLinkTargetsRemainUnreadableButTheLinkCanBeRemoved() async throws {
        let app = try await editorWebView()
        let files = AppFiles.shared
        let identifier = UUID().uuidString
        let target = files.data.deletingLastPathComponent().appendingPathComponent("ungranted-" + identifier)
        let link = files.cache.appendingPathComponent("ungranted-link-" + identifier)
        let bytes = Data("ungranted fixture".utf8)
        try bytes.write(to: target)
        defer {
            try? files.manager.removeItem(at: link)
            try? files.manager.removeItem(at: target)
        }
        try files.manager.createSymbolicLink(at: link, withDestinationURL: target)
        XCTAssertThrowsError(try files.resolve(target.absoluteString))
        _ = try await app.callAsyncJavaScript("""
            for(const action of ['resolveLocalFileSystemURI','getFileMetadata','readAsText']) {
                const error=await new Promise(resolve=>Bridge.exec(()=>resolve(null),resolve,'File',action,[uri,'UTF-8',0,100]));
                if(error!==2)throw Error('Unauthorized link access: '+action+' '+error);
            }
            await new Promise((resolve,reject)=>Bridge.exec(resolve,reject,'File','remove',[uri]));
            return true;
            """, arguments: ["uri": link.absoluteString], in: nil, contentWorld: .page)
        XCTAssertThrowsError(try files.manager.destinationOfSymbolicLink(atPath: link.path))
        XCTAssertEqual(try Data(contentsOf: target), bytes)
    }
}

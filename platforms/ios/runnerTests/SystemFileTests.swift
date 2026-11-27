import XCTest
@testable import runner

final class SystemFileTests: XCTestCase {
    private let files = AppFiles.shared
    private var directory: URL!

    override func setUpWithError() throws {
        directory = files.cache.appendingPathComponent("ios-system-files-" + UUID().uuidString)
        try files.manager.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws { try files.manager.removeItem(at: directory) }

    func testSymlinkExistenceAndRemovalNeverDeleteTheTarget() throws {
        let target = directory.appendingPathComponent("target # 日本語.txt")
        let link = directory.appendingPathComponent("link")
        XCTAssertEqual(try call("createSymlink", [target.lastPathComponent, link.path]) as? Int, 1)
        XCTAssertEqual(try call("fileExists", [link.path, "true"]) as? Int, 1)
        XCTAssertEqual(try call("fileExists", [link.path, "false"]) as? Int, 0)
        try Data("retain me".utf8).write(to: target)
        XCTAssertEqual(try call("fileExists", [link.path, "false"]) as? Int, 1)
        XCTAssertEqual(try call("createSymlink", [target.path, link.path]) as? Int, 0)
        _ = try call("deleteFile", [link.path])
        XCTAssertEqual(try String(contentsOf: target, encoding: .utf8), "retain me")
        XCTAssertEqual(try call("fileExists", [link.path, "true"]) as? Int, 0)
        XCTAssertEqual(try call("createSymlink", ["/etc", link.path]) as? Int, 0)
        try files.manager.createSymbolicLink(at: link, withDestinationURL: URL(fileURLWithPath: "/etc"))
        XCTAssertEqual(try call("fileExists", [link.path, "true"]) as? Int, 1)
        XCTAssertEqual(try call("fileExists", [link.path, "false"]) as? Int, 0)
        XCTAssertThrowsError(try call("writeText", [link.appendingPathComponent("escape").path, "escape"]))
        _ = try call("deleteFile", [link.path])
        XCTAssertEqual(try call("fileExists", [link.path, "true"]) as? Int, 0)
        XCTAssertThrowsError(try call("deleteFile", [directory.path]))
        XCTAssertTrue(files.manager.fileExists(atPath: target.path))
        XCTAssertThrowsError(try call("deleteFile", [files.cache.path]))
    }

    func testBinaryCopyReplacesFilesAndFailurePreservesExistingContent() throws {
        let source = directory.appendingPathComponent("source.bin")
        let destination = directory.appendingPathComponent("destination")
        let name = "copied # 50% 日本語.bin"
        let bytes = Data((0..<2_000_000).map { UInt8($0 % 256) })
        try bytes.write(to: source)
        _ = try call("copyToUri", [source.absoluteString, destination.absoluteString, name])
        let copied = destination.appendingPathComponent(name)
        XCTAssertEqual(try Data(contentsOf: copied), bytes)
        try Data([0, 255, 128]).write(to: source)
        _ = try call("copyToUri", [source.path, destination.path, name])
        XCTAssertEqual(try Data(contentsOf: copied), Data([0, 255, 128]))
        XCTAssertThrowsError(try call("copyToUri", [directory.appendingPathComponent("missing").path, destination.path, name]))
        XCTAssertEqual(try Data(contentsOf: copied), Data([0, 255, 128]))
        XCTAssertThrowsError(try call("copyToUri", [copied.path, destination.path, name]))
        XCTAssertThrowsError(try call("copyToUri", [source.path, destination.path, "../escape"]))
        XCTAssertThrowsError(try call("copyToUri", [directory.path, destination.path, name]))
        XCTAssertEqual(try files.manager.contentsOfDirectory(atPath: destination.path), [name])
    }

    func testPackagedAssetExtractionMatchesBundleAndRejectsTraversal() throws {
        let destination = directory.appendingPathComponent("asset.html")
        _ = try call("extractAsset", ["bundle/index.html", destination.path])
        XCTAssertEqual(try Data(contentsOf: destination), try Data(contentsOf: files.application.appendingPathComponent("bundle/index.html")))
        XCTAssertThrowsError(try call("extractAsset", ["../Library/test", destination.path]))
        XCTAssertThrowsError(try call("extractAsset", ["bundle/index.html", "/etc/acode-test"]))
        XCTAssertThrowsError(try call("extractAsset", ["not-a-bundled-asset", destination.path]))
    }

    private func call(_ action: String, _ args: [Any]) throws -> Any? { try SystemFiles.perform(action, args: args) }
}

@MainActor
final class SystemFileBridgeTests: BridgeTestCase {
    func testAndroidEditAndRunIntentsRejectWithoutPresentingAShareSheet() async throws {
        let webView = try await appWebView()
        let result = try await webView.callAsyncJavaScript("""
            for(const action of ['EDIT','RUN']) {
                const error=await new Promise(resolve=>system.fileAction('file:///missing.txt','missing.txt',action,'text/plain',resolve));
                if(error?.code!=='UNSUPPORTED_ACTION')throw Error('Unsupported intent did not reject');
            }
            return true;
            """, arguments: [:], in: nil, contentWorld: .page) as? Bool
        XCTAssertEqual(result, true)
        XCTAssertNil(webView.window?.rootViewController?.presentedViewController)
    }

    func testPublicUtilitiesRetainAndroidResultShapesAndFileContents() async throws {
        let webView = try await editorWebView()
        let directory = AppFiles.shared.cache.appendingPathComponent("ios-system-bridge-" + UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let result = try await webView.callAsyncJavaScript("""
            const call=(action,...args)=>new Promise((resolve,reject)=>system[action](...args,resolve,reject));
            await call('mkdirs',root+'/nested');
            const path=root+'/nested/test # 日本語.txt';
            if(await call('writeText',path,'Acode ✓')!=='File written successfully')throw Error('Write result changed');
            if(await call('fileExists',path,false)!==1)throw Error('Existence result changed');
            if(await call('getParentPath',path)!==root+'/nested')throw Error('Incorrect parent');
            const children=await call('listChildren',root+'/nested');
            if(children.length!==1||children[0]!==path)throw Error('Incorrect children');
            if((await call('listChildren',root+'/missing')).length)throw Error('Missing directory should be empty');
            if((await call('listChildren',path)).length)throw Error('File should not list children');
            const fs=acode.require('fsOperation');
            const uri='file://'+path;
            if(await fs(uri).readFile('utf-8')!=='Acode ✓\\n')throw Error('Write line terminator changed');
            try{await call('mkdirs',root+'/nested');throw Error('Existing directory accepted');}
            catch(error){if(error==='Existing directory accepted'||error?.message==='Existing directory accepted')throw error;}
            await call('deleteFile',path);
            if(await call('fileExists',path,false)!==0)throw Error('Delete failed');
            await call('deleteFile',root+'/nested');
            return true;
            """, arguments: ["root": directory.standardizedFileURL.resolvingSymlinksInPath().path], in: nil, contentWorld: .page) as? Bool
        XCTAssertEqual(result, true)
    }
}

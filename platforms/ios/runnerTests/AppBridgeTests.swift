import XCTest
import WebKit
@testable import runner

@MainActor
final class AppBridgeTests: BridgeTestCase {
    func testStartupIntentsWaitForTheEditorAndWarmIntentsArriveImmediately() async throws {
        let webView = try await editorWebView()
        defer { IncomingLinks.shared.reset(); webView.reload() }
        let url = try XCTUnwrap(URL(string: "acode://plugin/install/cold.start.fixture"))
        IncomingLinks.shared.reset()
        IncomingLinks.shared.receive(url)
        let early = try await webView.callAsyncJavaScript("""
            document.body.classList.add('loading');
            window.startupIntents = [];
            const receive = intent => startupIntents.push(intent.data);
            system.setIntentHandler(receive, error => { throw Error(error); });
            system.getIntent(receive, error => { throw Error(error); });
            await new Promise((resolve, reject) => Bridge.exec(resolve, reject, 'System', 'getArch', []));
            await new Promise(resolve => setTimeout(resolve, 200));
            return startupIntents;
            """, arguments: [:], in: nil, contentWorld: .page) as? [String]
        XCTAssertEqual(early, [])
        let cold = try await webView.callAsyncJavaScript("""
            document.body.classList.remove('loading');
            for (let n = 0; n < 50 && !startupIntents.length; n++)
                await new Promise(resolve => setTimeout(resolve, 100));
            return startupIntents;
            """, arguments: [:], in: nil, contentWorld: .page) as? [String]
        XCTAssertEqual(cold, [url.absoluteString])
        IncomingLinks.shared.receive(url)
        let warm = try await webView.callAsyncJavaScript("""
            for (let n = 0; n < 50 && startupIntents.length < 2; n++)
                await new Promise(resolve => setTimeout(resolve, 100));
            return startupIntents;
            """, arguments: [:], in: nil, contentWorld: .page) as? [String]
        XCTAssertEqual(warm, [url.absoluteString, url.absoluteString])
    }

    func testUnsupportedAppActionsRejectForNativeAndLegacyPlugins() async throws {
        let webView = try await editorWebView()
        let errors = try await webView.callAsyncJavaScript("""
            const attempt = (api, service, action, args = []) => new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(Error(service + '.' + action + ' did not settle')), 3000);
                api.exec(() => { clearTimeout(timer); resolve('unexpected success'); },
                    error => { clearTimeout(timer); resolve(String(error)); }, service, action, args);
            });
            return await Promise.all([
                attempt(Bridge, 'App', 'overrideButton', ['menubutton', true]),
                attempt(Bridge, 'App', 'clearHistory'),
                attempt(cordova, 'CoreAndroid', 'overrideBackbutton', [true]),
                attempt(cordova, 'CoreAndroid', 'overrideButton', ['volumeup', true]),
                attempt(cordova, 'CoreAndroid', 'clearHistory'),
            ]);
            """, arguments: [:], in: nil, contentWorld: .page) as? [String]
        XCTAssertEqual(errors, [
            "overrideButton is unavailable on iOS",
            "clearHistory is unavailable on iOS",
            "overrideButton is unavailable on iOS",
            "overrideButton is unavailable on iOS",
            "clearHistory is unavailable on iOS",
        ])
    }

    func testIncomingFileOpensInTheEditorWithItsOriginalName() async throws {
        let webView = try await appWebView()
        let name = "Incoming # 50% 日本語.txt"
        let url = AppFiles.shared.cache.appendingPathComponent(name)
        try Data("incoming file ✓".utf8).write(to: url)
        defer { try? FileManager.default.removeItem(at: url) }
        IncomingLinks.shared.receive(url)
        let opened = try await webView.callAsyncJavaScript("""
            for(let n=0;n<100;n++) {
                const file = window.editorManager?.getFile(uri,'uri');
                if(file) {
                    try { return file.filename === name && file.session.getValue() === 'incoming file ✓'; }
                    finally { await file.remove(true); }
                }
                await new Promise(resolve=>setTimeout(resolve,100));
            }
            throw Error('Incoming file did not open');
            """, arguments: ["uri": "file://" + url.path, "name": name], in: nil, contentWorld: .page) as? Bool
        XCTAssertEqual(opened, true)
    }

    func testEditorAvoidsSystemSafeAreas() async throws {
        let webView = try await appWebView()
        let window = try XCTUnwrap(webView.window)
        window.layoutIfNeeded()
        let frame = webView.convert(webView.bounds, to: window)
        XCTAssertGreaterThanOrEqual(frame.minY, window.safeAreaInsets.top)
        XCTAssertLessThanOrEqual(frame.maxY, window.bounds.height - window.safeAreaInsets.bottom)
    }
    func testEditorReadsEditsAndSavesAFile() async throws {
        let webView = try await appWebView()
        let result = try await webView.callAsyncJavaScript("""
            for(let n=0; !window.editorManager && n<100; n++) await new Promise(r=>setTimeout(r,100));
            const fsOperation = acode.require('fsOperation');
            const EditorFile = acode.require('EditorFile');
            const name = 'ios editor # 50% ✓.txt';
            const root = fsOperation(Bridge.file.cacheDirectory);
            let directoryError;
            try { await root.writeFile('must not replace a directory'); }
            catch(error) { directoryError = error.code; }
            if(directoryError !== 11) throw Error('Expected directory type mismatch, got ' + directoryError);
            const uri = await root.createFile(name, 'original');
            const fs = fsOperation(uri);
            let file;
            let stage = 'read';
            try {
                if(await fs.readFile('utf-8') !== 'original') throw Error('File read failed');
                stage = 'editor';
                file = new EditorFile(name, {uri, text:'original', isUnsaved:false});
                file.makeActive();
                file.session.setValue('edited ✓');
                await file.save();
                if(await fs.readFile('utf-8') !== 'edited ✓') throw Error('Editor save failed');
                stage = 'watch';
                const entry = await new Promise((resolve,reject)=>resolveLocalFileSystemURL(uri,resolve,reject));
                const changed = new Promise((resolve,reject)=>{
                    const watch=sdcard.watchFile(entry.nativeURL,()=>{clearTimeout(timer);watch.unwatch();resolve(true);},reject);
                    const timer=setTimeout(()=>{watch.unwatch();reject(Error('File watch timed out'));},5000);
                });
                await fs.writeFile('external edit');
                await changed;
                return true;
            } catch(error) { throw Error(stage + ': ' + JSON.stringify(error) + ' ' + error?.message);
            } finally { if(file) await file.remove(true); await fs.delete(); }
            """, arguments: [:], in: nil, contentWorld: .page) as? Bool
        XCTAssertEqual(result, true)
    }

    func testEditorWorkerLoadsFromFileURL() async throws {
        let webView = try await editorWebView()
        let result = try await webView.callAsyncJavaScript("""
            await new Promise(resolve => document.addEventListener('deviceready', resolve));
            const call = (action,args)=>new Promise((resolve,reject)=>Bridge.exec(resolve,error=>reject(Error(action+': '+JSON.stringify(error))),'File',action,args));
            const entry = await call('getFile',[Bridge.file.cacheDirectory,'worker # ? 50% 日本語.js',{create:true}]);
            await call('write',[entry.nativeURL,'postMessage({answer:42});',0,false]);
            const file = await new Promise((resolve,reject)=>resolveLocalFileSystemURI(entry.nativeURL,resolve,error=>reject(Error('resolve '+entry.nativeURL+': '+JSON.stringify(error)))));
            try {
                return await new Promise((resolve,reject)=>{
                    const worker = new Worker(file.toInternalURL());
                    const timer = setTimeout(()=>{worker.terminate();reject(Error('Worker timed out'));},5000);
                    worker.onmessage = e=>{clearTimeout(timer);worker.terminate();resolve(e.data.answer);};
                    worker.onerror = e=>{clearTimeout(timer);worker.terminate();reject(Error(e.message));};
                });
            } finally { await call('remove',[entry.nativeURL]); }
            """, arguments: [:], in: nil, contentWorld: .page) as? Int
        XCTAssertEqual(result, 42)
    }


    func testNativeStartupAndFileBridge() async throws {
        let webView = try await appWebView()
        let result = try await webView.callAsyncJavaScript("""
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(Error('Native startup timed out')), 10000);
                document.addEventListener('deviceready', () => { clearTimeout(timeout); resolve(); });
            });
            const call = (service, action, args = []) => new Promise((resolve, reject) => Bridge.exec(resolve, reject, service, action, args));
            const root = await call('File', 'resolveLocalFileSystemURI', [Bridge.file.cacheDirectory]);
            const name = 'ios-bridge-' + Date.now() + '.txt';
            const entry = await call('File', 'getFile', [Bridge.file.cacheDirectory, name, {create:true, exclusive:true}]);
            try {
                const bytes = new Uint8Array([0, 127, 128, 159, 255]).buffer;
                await call('File', 'write', [entry.nativeURL, bytes, 0, true]);
                const read = await call('File', 'readAsArrayBuffer', [entry.nativeURL, 0, 5]);
                const values = [...new Uint8Array(read)];
                if (values.join(',') !== '0,127,128,159,255') throw Error('Binary roundtrip: ' + values);
                await call('File', 'write', [entry.nativeURL, 'Acode ✓', 0, false]);
                const text = await call('File', 'readAsText', [entry.nativeURL, 'UTF-8', 0, 99]);
                if (text !== 'Acode ✓') throw Error('Text roundtrip: ' + text);
                const resolved = await new Promise((resolve, reject) => resolveLocalFileSystemURL(entry.nativeURL, resolve, reject));
                const response = await fetch(resolved.toInternalURL());
                if (await response.text() !== text) throw Error('Scheme URL does not match native file');
                let unavailable = false;
                try { await call('MissingService', 'action'); } catch { unavailable = true; }
                return {platform: Bridge.platformId, directory: root.isDirectory, unavailable, compatibility: cordova.file === Bridge.file};
            } finally { await call('File', 'remove', [entry.nativeURL]); }
            """, arguments: [:], in: nil, contentWorld: .page) as? [String: Any]
        XCTAssertEqual(result?["platform"] as? String, "ios")
        XCTAssertEqual(result?["directory"] as? Bool, true)
        XCTAssertEqual(result?["unavailable"] as? Bool, true)
        XCTAssertEqual(result?["compatibility"] as? Bool, true)
    }

    func testEditorFinishesStartup() async throws {
        let webView = try await appWebView()
        webView.configuration.userContentController.addUserScript(WKUserScript(source: "window.startupErrors=[]; addEventListener('error',e=>startupErrors.push(e.message+' '+e.filename+':'+e.lineno)); addEventListener('unhandledrejection',e=>startupErrors.push(JSON.stringify(e.reason)+' '+e.reason?.stack));", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        webView.reload()
        try await Task.sleep(for: .seconds(1))
        for _ in 0..<100 {
            let ready = try await webView.evaluateJavaScript("!!window.editorManager && !document.body.classList.contains('loading')") as? Bool
            if ready == true { return }
            try await Task.sleep(for: .milliseconds(200))
        }
        let state = try await webView.evaluateJavaScript("JSON.stringify({body:document.body.innerText.slice(0,1200),attributes:document.body.outerHTML.slice(0,1000),manager:typeof window.editorManager,acode:typeof window.acode,errors:window.startupErrors,scripts:[...document.scripts].map(s=>s.src)})")
        XCTFail("Editor did not finish startup: \(String(describing: state))")
    }

}

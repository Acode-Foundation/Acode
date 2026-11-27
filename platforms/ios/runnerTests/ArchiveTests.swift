import XCTest
import WebKit
@testable import runner

@MainActor
final class ArchiveTests: BridgeTestCase {
    func testFileBrowserCompressesAndImportsBinaryUnicodeAndEmptyEntries() async throws {
        let app = try await editorWebView()
        let manager = FileManager.default
        let directory = AppFiles.shared.documents.appendingPathComponent("Archive fixture " + UUID().uuidString)
        let nested = directory.appendingPathComponent("日本語 # sample")
        var bytes = Data(count: 32 * 1024 * 1024)
        bytes.withUnsafeMutableBytes { (buffer: UnsafeMutableRawBufferPointer) in
            for index in buffer.indices { buffer[index] = UInt8(truncatingIfNeeded: index * 31 + 7) }
        }
        try manager.createDirectory(at: nested.appendingPathComponent("empty"), withIntermediateDirectories: true)
        try bytes.write(to: nested.appendingPathComponent("binary #.bin"))
        try Data().write(to: nested.appendingPathComponent("blank.txt"))
        try "Archive ✓".write(to: directory.appendingPathComponent("notes.txt"), atomically: true, encoding: .utf8)
        defer { try? manager.removeItem(at: directory) }
        do {
            let uri = try await app.callAsyncJavaScript("""
                window.archiveFixture={storage:localStorage.storageList,state:localStorage.fileBrowserState};
                delete localStorage.storageList;
                let stage='open browser';
                try {
                const wait=async check=>{for(let n=0;n<200;n++){if(await check())return;await new Promise(r=>setTimeout(r,50));}throw Error('Archive interaction timed out');};
                acode.require('fileBrowser')('file','Archive fixture',false).catch(()=>{});
                await wait(()=>document.querySelector('#file-browser li[data-uuid="ios-documents"]'));
                const browser=document.getElementById('file-browser');
                const page=browser.closest('wc-page');
                stage='open documents';
                browser.querySelector('li[data-uuid="ios-documents"]').click();
                await wait(()=>browser.querySelector('li[data-name="'+name+'"]'));
                browser.querySelector('li[data-name="'+name+'"]').click();
                stage='select entries';
                await wait(()=>browser.querySelector('li[data-name="notes.txt"]'));
                page.querySelector('[data-action="toggle-menu"]').click();
                document.querySelector('.context-menu [action="select-items"]').click();
                await wait(()=>!document.querySelector('.context-menu'));
                browser.querySelector('li[data-name="日本語 # sample"]').click();
                browser.querySelector('li[data-name="notes.txt"]').click();
                page.querySelector('[data-action="toggle-menu"]').click();
                document.querySelector('.context-menu [action="compress"]').click();
                stage='read generated archive';
                let archive;
                await wait(async()=>{
                    const entries=await acode.require('fsOperation')(uri).lsDir();
                    archive=entries.find(entry=>entry.name.startsWith('archive_')&&entry.name.endsWith('.zip'));
                    return archive && browser.querySelector('li[data-name="'+archive.name+'"]');
                });
                return archive.url;
                }catch(error){throw Error(stage+': '+(error?.message||JSON.stringify(error)));}
                """, arguments: ["name": directory.lastPathComponent, "uri": "file://" + directory.path], in: nil, contentWorld: .page) as? String
            let archive = try AppFiles.shared.resolve(XCTUnwrap(uri))
            XCTAssertGreaterThan(try Data(contentsOf: archive).count, bytes.count)
            let first = archive.deletingPathExtension()
            try await importArchive(archive, app: app)
            try await verifyImport(first, bytes: bytes)
            try "First import retained".write(to: first.appendingPathComponent("notes.txt"), atomically: true, encoding: .utf8)
            try await importArchive(archive, app: app)
            var second: URL?
            for _ in 0..<100 {
                second = try manager.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil).first {
                    $0.lastPathComponent.hasPrefix(first.lastPathComponent + "_")
                }
                if second != nil { break }
                try await Task.sleep(for: .milliseconds(50))
            }
            try await verifyImport(XCTUnwrap(second), bytes: bytes)
            try await cancelImport(archive, in: directory, app: app)
            XCTAssertEqual(try String(contentsOf: first.appendingPathComponent("notes.txt"), encoding: .utf8), "First import retained")
        } catch {
            try? await cleanup(app)
            throw error
        }
        try await cleanup(app)
    }

    private func cancelImport(_ archive: URL, in directory: URL, app: WKWebView) async throws {
        _ = try await app.callAsyncJavaScript("""
            const fs=acode.require('fsOperation')(uri);
            const names=entries=>JSON.stringify(entries.map(entry=>entry.name).sort());
            const state=window.archiveCancellation={exec:Bridge.exec,release:null,held:false,fs,names,before:names(await fs.lsDir())};
            // Hold one real write's completion so the normal Cancel button can be exercised.
            Bridge.exec=(success,error,service,action,args=[])=>{
                const size=args[1]?.byteLength||args[1]?.length||0;
                if(!state.held&&service==='File'&&action==='write'&&String(args[0]).includes(marker)&&size>1024*1024) {
                    state.held=true;
                    return state.exec((...values)=>{state.release=()=>success?.(...values);},error,service,action,args);
                }
                return state.exec(success,error,service,action,args);
            };
            """, arguments: ["uri": "file://" + directory.path, "marker": String(directory.lastPathComponent.suffix(36))], in: nil, contentWorld: .page)
        try await importArchive(archive, app: app)
        let cancelled = try await app.callAsyncJavaScript("""
            const state=window.archiveCancellation;
            const wait=async check=>{for(let n=0;n<400;n++){if(await check())return;await new Promise(r=>setTimeout(r,50));}throw Error('Archive cancellation timed out');};
            try {
                await wait(()=>state.release&&document.querySelector('#__loader button'));
                if(state.names(await state.fs.lsDir())===state.before)throw Error('No partial import to cancel');
                document.querySelector('#__loader button').click();
                Bridge.exec=state.exec;
                const release=state.release;state.release=null;release();
                await wait(async()=>state.names(await state.fs.lsDir())===state.before&&!document.getElementById('__loader'));
                return true;
            } finally {
                Bridge.exec=state.exec;state.release?.();delete window.archiveCancellation;
            }
            """, arguments: [:], in: nil, contentWorld: .page) as? Bool
        XCTAssertEqual(cancelled, true)
    }

    private func importArchive(_ archive: URL, app: WKWebView) async throws {
        _ = try await app.evaluateJavaScript("""
            document.getElementById('file-browser').closest('wc-page').querySelector('[data-action="toggle-add-menu"]').click();
            document.querySelector('.context-menu [action="import-project-zip"]').click();
            """)
        var responder: UIResponder? = app
        while responder != nil, !(responder is WebViewController) { responder = responder?.next }
        let host = try XCTUnwrap(responder as? WebViewController)
        var picker: UIDocumentPickerViewController?
        for _ in 0..<100 {
            if let presented = host.presentedViewController as? UIDocumentPickerViewController, !presented.isBeingPresented {
                picker = presented; break
            }
            try await Task.sleep(for: .milliseconds(50))
        }
        let selected = try XCTUnwrap(picker)
        // Simulated selection can finish before the remote document service disconnects.
        addTeardownBlock { @MainActor in withExtendedLifetime(selected) {} }
        selected.delegate?.documentPicker?(selected, didPickDocumentsAt: [archive])
        await withCheckedContinuation { continuation in selected.dismiss(animated: false) { continuation.resume() } }
    }

    private func verifyImport(_ directory: URL, bytes: Data) async throws {
        let notes = directory.appendingPathComponent("notes.txt")
        for _ in 0..<200 {
            if (try? String(contentsOf: notes, encoding: .utf8)) == "Archive ✓" { break }
            try await Task.sleep(for: .milliseconds(50))
        }
        let nested = directory.appendingPathComponent("日本語 # sample")
        XCTAssertEqual(try String(contentsOf: notes, encoding: .utf8), "Archive ✓")
        XCTAssertEqual(try Data(contentsOf: nested.appendingPathComponent("binary #.bin")), bytes)
        XCTAssertEqual(try Data(contentsOf: nested.appendingPathComponent("blank.txt")), Data())
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: nested.appendingPathComponent("empty").path), [])
    }

    private func cleanup(_ app: WKWebView) async throws {
        _ = try await app.callAsyncJavaScript("""
            const cancellation=window.archiveCancellation;
            if(cancellation){
                document.querySelector('#__loader button')?.click();
                Bridge.exec=cancellation.exec;cancellation.release?.();delete window.archiveCancellation;
            }
            const page=document.getElementById('file-browser')?.closest('wc-page');
            if(page?.querySelector('.selection-mode'))page.querySelector('[data-action="close"]').click();
            page?.querySelector('[data-action="close"]')?.click();
            for(let n=0;page?.isConnected&&n<100;n++)await new Promise(resolve=>setTimeout(resolve,20));
            if(page?.isConnected)throw Error('Archive browser did not close');
            const saved=window.archiveFixture;
            if(saved){
                if(saved.storage===undefined)delete localStorage.storageList;else localStorage.storageList=saved.storage;
                if(saved.state===undefined)delete localStorage.fileBrowserState;else localStorage.fileBrowserState=saved.state;
            }
            delete window.archiveFixture;
            """, arguments: [:], in: nil, contentWorld: .page)
    }
}

import XCTest
import WebKit
@testable import runner

@MainActor
final class FilesBrowserTests: BridgeTestCase {
    func testLocalDocumentsCanBeBrowsedWithoutAndroidStorageEntries() async throws {
        let app = try await appWebView()
        let files = AppFiles.shared
        let file = files.documents.appendingPathComponent("browser-fixture-" + UUID().uuidString + ".txt")
        try "Files browser ✓".write(to: file, atomically: true, encoding: .utf8)
        defer { try? files.manager.removeItem(at: file) }
        let result = try await app.callAsyncJavaScript("""
            for(let n=0;(!window.editorManager||document.body.classList.contains('loading'))&&n<100;n++)
                await new Promise(r=>setTimeout(r,100));
            const storageList=localStorage.storageList, state=localStorage.fileBrowserState;
            const settings=acode.require('settings'), feedback=settings.value.vibrateOnTap;
            try {
                settings.value.vibrateOnTap=true;
                delete localStorage.storageList;
                let selection;
                acode.require('fileBrowser')('file','Files fixture',false).then(value=>selection=value,()=>selection=false);
                for(let n=0;!document.querySelector('#file-browser li[data-uuid="ios-documents"]')&&n<100;n++)
                    await new Promise(r=>setTimeout(r,50));
                const browser=document.getElementById('file-browser');
                const entries=[...browser.querySelectorAll('li[data-uuid]')].map(item=>item.dataset.uuid);
                const documents=browser.querySelector('li[data-uuid="ios-documents"]');
                if(!documents)throw new Error('Missing Documents: '+JSON.stringify(await new Promise((resolve,reject)=>sdcard.listStorages(resolve,reject)))+'; '+browser.outerHTML);
                documents.click();
                for(let n=0;!browser.querySelector(`li[data-name="${name}"]`)&&n<100;n++)
                    await new Promise(r=>setTimeout(r,50));
                const entry=browser.querySelector(`li[data-name="${name}"]`);
                if(!entry)throw new Error('Documents did not open: '+browser.innerText);
                for(let n=0;document.getElementById('__loader')&&n<100;n++)await new Promise(r=>setTimeout(r,50));
                if(document.getElementById('__loader'))throw Error('Files browser is still loading');
                entry.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));
                for(let n=0;!document.querySelector('.prompt.select:not(.hide)')&&n<100;n++)
                    await new Promise(r=>setTimeout(r,50));
                const menu=document.querySelector('.prompt.select:not(.hide)');
                if(!menu?.textContent.includes(strings.rename))throw Error('File context menu did not open with tap feedback');
                await acode.require('actionStack').pop();
                for(let n=0;menu.isConnected&&n<100;n++)await new Promise(r=>setTimeout(r,50));
                if(menu.isConnected)throw Error('File context menu did not dismiss');
                entry.click();
                for(let n=0;selection===undefined&&n<100;n++)await new Promise(r=>setTimeout(r,50));
                return {entries,name:selection.name,text:await acode.require('fsOperation')(selection.url).readFile('utf-8')};
            } finally {
                settings.value.vibrateOnTap=feedback;
                document.querySelector('#file-browser')?.closest('wc-page')?.querySelector('[data-action="close"]')?.click();
                if(storageList===undefined)delete localStorage.storageList;else localStorage.storageList=storageList;
                if(state===undefined)delete localStorage.fileBrowserState;else localStorage.fileBrowserState=state;
            }
            """, arguments: ["name": file.lastPathComponent], in: nil, contentWorld: .page)
        let value = try XCTUnwrap(result as? [String: Any])
        let entries = try XCTUnwrap(value["entries"] as? [String])
        XCTAssertTrue(entries.contains("ios-documents"))
        XCTAssertTrue(entries.contains("terminal-public"))
        XCTAssertFalse(entries.contains("internal-storage"))
        XCTAssertEqual(value["name"] as? String, file.lastPathComponent)
        XCTAssertEqual(value["text"] as? String, "Files browser ✓")
    }
}

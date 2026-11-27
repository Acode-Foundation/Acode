import XCTest
import WebKit
@testable import runner

@MainActor
final class WorkspaceSearchTests: BridgeTestCase {
    func testNativeIndexAndSearchUIReadIOSWorkspace() async throws {
        let app = try await appWebView()
        let directory = AppFiles.shared.cache.appendingPathComponent("search-fixture-" + UUID().uuidString, isDirectory: true)
        let nested = directory.appendingPathComponent("nested", isDirectory: true)
        try FileManager.default.createDirectory(at: nested, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        try Data("iOSWorkspaceNeedle923 first\n".utf8).write(to: directory.appendingPathComponent("match.txt"))
        try Data("const text = 'iOSWorkspaceNeedle923';\n".utf8).write(to: nested.appendingPathComponent("name # ✓.js"))
        let result = try await app.callAsyncJavaScript("""
            for(let n=0;!window.editorManager&&n<100;n++) await new Promise(resolve=>setTimeout(resolve,100));
            const fileList=acode.require('fileList');
            const index=acode.require('fileIndex');
            if(!index.supports(root)) throw Error('Native index unavailable');
            const apps=acode.require('sidebarApps');
            const searchApp=apps.get('searchInFiles');
            const openedSidebar=!document.querySelector('#sidebar');
            if(openedSidebar)acode.exec('toggle-sidebar');
            const oldActive=document.querySelector('[data-action="sidebar-app"].active')?.dataset.id;
            acode.require('openfolder')(root,{name:'iOS search fixture',saveState:false,listFiles:true});
            const folder=acode.require('addedfolder').find(item=>item.url===root);
            let input;
            let originalInput;
            try {
                let found=[];
                for(let n=0;n<100;n++) {
                    found=(await index.query({roots:[root]})).entries;
                    if(found.length===2) break;
                    await new Promise(resolve=>setTimeout(resolve,100));
                }
                if(found.length!==2) throw Error('File discovery incomplete: '+JSON.stringify(found));
                document.querySelector('[data-action="sidebar-app"][data-id="searchInFiles"]').click();
                input=searchApp.querySelector('[name="search"]');
                originalInput=input.value;
                input.value='iOSWorkspaceNeedle923';
                input.dispatchEvent(new Event('input',{bubbles:true}));
                for(let n=0;n<100;n++) {
                    const counts=[...searchApp.querySelectorAll('.search-result-header strong')].map(el=>Number(el.textContent));
                    if(counts.length===2&&counts.every(count=>count===2)) return true;
                    await new Promise(resolve=>setTimeout(resolve,100));
                }
                throw Error('Search did not find both files: '+searchApp.textContent);
            } finally {
                if(input) {input.value=originalInput;input.dispatchEvent(new Event('input',{bubbles:true}));}
                folder?.remove();
                const previous=document.querySelector('[data-action="sidebar-app"][data-id="'+CSS.escape(oldActive||"files")+'"]');previous?.click();
                if(openedSidebar)acode.exec('toggle-sidebar');
            }
            """, arguments: ["root": directory.absoluteString], in: nil, contentWorld: .page) as? Bool
        XCTAssertEqual(result, true)
    }
}

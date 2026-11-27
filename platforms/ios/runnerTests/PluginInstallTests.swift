import XCTest
import CryptoKit
@testable import runner

@MainActor
final class PluginInstallTests: BridgeTestCase {
    func testLocalZipInstallsLoadsLegacyAPIsAndUnmounts() async throws {
        let webView = try await appWebView()
        let fixture = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "install-plugin", withExtension: "zip"))
        let archive = AppFiles.shared.cache.appendingPathComponent("plugin install # 日本語.zip")
        try Data(contentsOf: fixture).write(to: archive)
        defer { try? FileManager.default.removeItem(at: archive) }
        let expected = SHA256.hash(data: Data("Acode fixture".utf8)).map { String(format: "%02x", $0) }.joined()
        let result = try await webView.callAsyncJavaScript("""
            const wait=async check=>{for(let n=0;n<300;n++){if(check())return;await new Promise(r=>setTimeout(r,100));}throw Error('Plugin interaction timed out');};
            await wait(()=>!app.classList.contains('loading'));
            const fs=acode.require('fsOperation');
            const id='app.acode.ios-install-fixture';
            const directory=PLUGIN_DIR+'/'+id;
            if(await fs(directory).exists())throw Error('Fixture plugin already exists');
            if(!(await fs(uri).exists()))throw Error('ZIP source missing');
            const errors=[];
            const log=console.error;
            let unmounted=false;
            console.error=(...args)=>{errors.push(args.map(e=>e?.message||JSON.stringify(e)).join(' '));log(...args);};
            try {
                await acode.exec('open','plugins');
                await wait(()=>document.querySelector('[data-action="add-source"]'));
                document.querySelector('[data-action="add-source"]').click();
                document.querySelector('.context-menu [data-action="remote"]').click();
                await wait(()=>document.querySelector('.prompt input[type="url"]'));
                const input=document.querySelector('.prompt input[type="url"]');
                input.value=uri;
                input.dispatchEvent(new Event('input',{bubbles:true}));
                input.closest('form').querySelector('button[type="submit"]').click();
                await wait(()=>window.iosInstalledPlugin);
                await wait(()=>!document.getElementById('__loader'));
                document.getElementById('installed_plugins').click();
                await wait(()=>document.querySelector('#plugin-list [data-id="'+id+'"]'));
                const loaded=window.iosInstalledPlugin;
                if(JSON.stringify(loaded.bytes)!=='[0,127,128,255,10]'||loaded.checksum!==checksum||!loaded.firstInit||loaded.secret!=='default')throw Error('Plugin initialization lost data or API compatibility');
                if(!(await fs(directory+'/empty').exists()))throw Error('Empty ZIP folder missing');
                const manifest=await fs(directory+'/plugin.json').readFile('json');
                if(manifest.source!==uri)throw Error('Local installation source missing');
                acode.unmountPlugin(id);
                unmounted=true;
                if(window.iosInstalledPlugin)throw Error('Plugin unmount did not run');
                return true;
            }catch(error){throw Error(error.message+'; '+errors.join('; '));}finally{
                console.error=log;
                if(!unmounted)acode.unmountPlugin(id);
                document.getElementById(id+'-mainScript')?.remove();
                if(await fs(directory).exists())await fs(directory).delete();
                const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(id));
                const state=DATA_STORAGE+'/.install-state/'+[...new Uint8Array(bytes)].map(n=>n.toString(16).padStart(2,'0')).join('');
                if(await fs(state).exists())await fs(state).delete();
                acode.require('actionStack').pop();
            }
            """, arguments: ["uri": "file://" + archive.path, "checksum": expected], in: nil, contentWorld: .page) as? Bool
        XCTAssertEqual(result, true)
    }
}

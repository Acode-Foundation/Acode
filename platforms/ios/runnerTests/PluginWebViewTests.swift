import XCTest
import WebKit
@testable import runner

@MainActor
final class PluginWebViewTests: BridgeTestCase {
    func testHiddenWebViewMessagingNavigationIsolationAndReload() async throws {
        let app = try await editorWebView()
        let fixture = try HTTPFixture()
        try await fixture.start()
        defer { fixture.stop() }
        let result = try await app.callAsyncJavaScript("""
            const view=await acode.require('webview').create({mode:'hidden',allowNavigation:false});
            const loaded=()=>new Promise((resolve,reject)=>{
                const timer=setTimeout(()=>{view.off('pageFinished',listener);reject(Error('WebView load timed out'))},5000);
                function listener(){clearTimeout(timer);view.off('pageFinished',listener);resolve()}
                view.on('pageFinished',listener);
            });
            let stage="load";
            try {
                let early;
                view.onMessage(message=>{early=message});
                let page=loaded();
                await view.loadHTML('<!doctype html><meta charset="utf-8"><title>Plugin view ✓</title><script>window.state=42;webview.postMessage({early:"ready ✓"});webview.onMessage(value=>webview.postMessage({echo:value}));</script>');
                await page;
                if(early?.early!=='ready ✓') throw Error('Document-start messaging missing');
                if(await view.evaluate('Boolean(window.Bridge || window.webkit.messageHandlers.exec)')!=='false') throw Error('Native bridge exposed');
                stage='messages';
                const echoed=new Promise(resolve=>view.onMessage(resolve));
                const payload={code:"'\\n</script>\\u2028 ✓",values:[0,1,true]};
                await view.postMessage(payload);
                if(JSON.stringify((await echoed).echo)!==JSON.stringify(payload)) throw Error('Message payload changed');
                stage='evaluate';
                if(await view.evaluate('state')!=='42') throw Error('Evaluate number changed');
                if(await view.evaluate('JSON.stringify({a:1})')!=='{"a":1}') throw Error('Evaluate string changed');
                stage='navigation';
                await view.evaluate('location.href='+JSON.stringify(origin));
                await new Promise(resolve=>setTimeout(resolve,100));
                if(await view.evaluate('document.title')!=='Plugin view ✓') throw Error('Navigation restriction ignored');
                for(const url of ['file:///etc/passwd','acode://localhost/','javascript:alert(1)']) {
                    let rejected=false;try{await view.loadURL(url)}catch{rejected=true}
                    if(!rejected) throw Error('Forbidden URL accepted');
                }
                let rejected=false;try{await view.show()}catch{rejected=true}
                if(!rejected) throw Error('Hidden view was shown');
                await view.hide();
                stage='reload';
                page=loaded(); await view.reload(); await page;
                stage='evaluate';
                if(await view.evaluate('state')!=='42') throw Error('Reload lost content');
                stage='explicit URL';
                page=loaded(); await view.loadURL(origin+'/page'); await page;
                if(!(await view.evaluate('location.href')).startsWith(origin)) throw Error('Explicit navigation blocked');
                return true;
            } catch(error) { throw Error(stage+": "+(error?.message||error)); } finally { await view.destroy(); }
            """, arguments: ["origin": fixture.origin], in: nil, contentWorld: .page) as? Bool
        XCTAssertEqual(result, true)
    }

    func testFullscreenWebViewPreservesStateOnHideAndEmitsClosed() async throws {
        let app = try await editorWebView()
        let prepared = try await app.callAsyncJavaScript("""
            const view=await acode.require('webview').create({mode:'fullscreen',visible:false,title:'Plugin fixture'});
            window.pluginViewFixture=view;
            window.pluginViewClosed=false;
            view.on('closed',()=>{window.pluginViewClosed=true});
            const loaded=new Promise((resolve,reject)=>{
                const timer=setTimeout(()=>reject(Error('Fullscreen load timed out')),5000);
                view.on('pageFinished',()=>{clearTimeout(timer);resolve()});
            });
            await view.loadHTML('<!doctype html><title>Fullscreen</title><script>window.state=7;</script>');
            let rejected=false;try{await view.evaluate('state')}catch{rejected=true}
            if(!rejected) throw Error('Deferred view evaluated before showing');
            await view.show(); await loaded;
            await view.evaluate('state=99');
            await view.hide(); await view.show();
            if(await view.evaluate('state')!=='99') throw Error('Hide destroyed page state');
            return true;
            """, arguments: [:], in: nil, contentWorld: .page) as? Bool
        XCTAssertEqual(prepared, true)
        var responder: UIResponder? = app
        while responder != nil, !(responder is WebViewController) { responder = responder?.next }
        let controller = try XCTUnwrap(responder as? WebViewController)
        let browser = try XCTUnwrap(controller.presentedViewController as? PreviewViewController)
        browser.close()
        let closed = try await app.callAsyncJavaScript("""
            for(let n=0;!window.pluginViewClosed&&n<50;n++) await new Promise(resolve=>setTimeout(resolve,100));
            let rejected=false;try{await window.pluginViewFixture.evaluate('1')}catch{rejected=true}
            delete window.pluginViewFixture;
            const closed=window.pluginViewClosed;delete window.pluginViewClosed;
            return closed&&rejected;
            """, arguments: [:], in: nil, contentWorld: .page) as? Bool
        XCTAssertEqual(closed, true)
    }
}

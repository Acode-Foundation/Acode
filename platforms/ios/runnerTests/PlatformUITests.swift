import XCTest
import WebKit
@testable import runner

@MainActor
final class PlatformUITests: BridgeTestCase {
    func testCoveredEditorReturnsWithItsDocumentAndScrollPosition() async throws {
        let webView = try await editorWebView()
        let result = try await webView.callAsyncJavaScript("""
            const wait=async (label,check)=>{for(let n=0;n<100;n++){if(check())return;await new Promise(r=>setTimeout(r,50));}throw Error('Editor page did not settle: '+label);};
            const text=Array.from({length:300},(line,index)=>'Page navigation fixture '+index).join('\\n');
            const previous=editorManager.activeFile;
            const file=new (acode.require('EditorFile'))('page-navigation-fixture.txt',{text,isUnsaved:false});
            const page=acode.require('page')('Navigation fixture');
            try {
                file.makeActive();
                await new Promise(resolve=>setTimeout(resolve,1000));
                const view=editorManager.editor,dom=view.dom,scroller=view.scrollDOM;
                scroller.scrollTop=300;
                await wait('initial scroll',()=>scroller.scrollTop>0);
                const scrollTop=scroller.scrollTop;
                document.body.append(page);
                await wait('cover shown',()=>page.isConnected&&getComputedStyle(page).opacity==='1');
                if(!root.isConnected||root.handler.$replacement.isConnected)throw Error('Primary editor was detached');
                page.hide();
                await wait('root restored',()=>root.isConnected&&!page.isConnected);
                await wait('scroll position restored',()=>scroller.scrollTop===scrollTop);
                if(editorManager.editor!==view||view.dom!==dom||!dom.isConnected)throw Error('Editor was rebuilt');
                if(view.state.doc.toString()!==text)throw Error('Editor contents changed');
                if(document.querySelectorAll('.page-replacement').length)throw Error('Page placeholder leaked');
                return true;
            } finally {
                page.hide();
                await file.remove(true);
                previous?.makeActive();
            }
            """, arguments: [:], in: nil, contentWorld: .page) as? Bool
        XCTAssertEqual(result, true)
    }

    func testEmptyNavigationDoesNotOfferToExitButStillClosesDialogs() async throws {
        let webView = try await editorWebView()
        let result = try await webView.callAsyncJavaScript("""
            const stack = acode.require('actionStack');
            const settings = acode.require('settings');
            if(stack.length) throw Error('Navigation fixture needs an empty stack');
            const original = {confirm:settings.value.confirmOnExit, close:stack.onCloseApp, exec:Bridge.exec};
            let exits = 0, callbacks = 0;
            Bridge.exec = (...args) => {
                if(args[2] === 'App' && args[3] === 'exitApp') exits++;
                return original.exec(...args);
            };
            stack.onCloseApp = () => {callbacks++;};
            try {
                for(const confirmOnExit of [true, false]) {
                    settings.value.confirmOnExit = confirmOnExit;
                    const pending = stack.pop();
                    await new Promise(resolve => setTimeout(resolve,50));
                    const unexpected = document.querySelector('.prompt.confirm:not(.hide)');
                    if(unexpected) {
                        unexpected.querySelector('button').click();
                        await pending;
                        throw Error('iOS offered to exit');
                    }
                    await pending;
                }
                const confirmation = acode.require('confirm')('Navigation fixture', 'Dismiss this dialog');
                if(stack.length !== 1) throw Error('Dialog was not stacked');
                await stack.pop();
                if(await confirmation !== false || stack.length) throw Error('Dialog dismissal changed');
                if(exits || callbacks) throw Error('Unsupported exit flow invoked');
                return true;
            } finally {
                settings.value.confirmOnExit = original.confirm;
                stack.onCloseApp = original.close;
                Bridge.exec = original.exec;
            }
            """, arguments: [:], in: nil, contentWorld: .page) as? Bool
        XCTAssertEqual(result, true)
    }

    func testSettingsAboutAndDiagnosticsAvoidAndroidStoreActions() async throws {
        let webView = try await editorWebView()
        let result = try await webView.callAsyncJavaScript("""
            const wait=async check=>{for(let n=0;n<100;n++){if(check())return;await new Promise(r=>setTimeout(r,50));}throw Error('Platform UI did not settle');};
            const openBrowser=system.openInBrowser, copy=Bridge.clipboard.copy;
            const opened=[];
            let copied='';
            system.openInBrowser=(...args)=>opened.push(args);
            Bridge.clipboard.copy=value=>{copied=value;};
            const stack=acode.require('actionStack');
            let settingsPage,cover;
            try {
                await acode.exec('open','settings');
                await wait(()=>document.querySelector('.main-settings-page [data-key="about"]'));
                settingsPage=acode.require('settings').uiSettings['main-settings'];
                const rating=document.querySelector('.main-settings-page [data-key="rateapp"]');
                if(rating&&!rating.hidden)throw Error('Google Play rating is visible on iOS');
                if(settingsPage.search('rate').some(item=>item.dataset.key==='rateapp'))throw Error('Search reveals unavailable rating action');
                const pro=document.querySelector('.main-settings-page [data-key="removeads"]');
                if(pro&&(pro.textContent.includes(strings['iap-pro-purchase-warning'])||!pro.textContent.includes('Apple Account')))throw Error('Pro restoration instructions target the wrong store');
                rating?.click();
                const settingsElement=document.querySelector('.main-settings-page');
                const body=settingsPage.getListElement();
                body.scrollTop=100;
                await new Promise(resolve=>setTimeout(resolve,100));
                const scrollTop=body.scrollTop;
                document.querySelector('.main-settings-page [data-key="about"]').click();
                await wait(()=>document.querySelector('#about-page')?.textContent.includes('com.apple.WebKit'));
                if(!settingsElement.isConnected)throw Error('Previous page was detached too early');
                cover=acode.require('page')('Nested navigation fixture');
                document.body.append(cover);
                await wait(()=>!settingsElement.isConnected);
                if(!settingsElement.handler.$replacement.isConnected)throw Error('Deeply covered settings page lost its placeholder');
                cover.hide();
                await wait(()=>settingsElement.isConnected&&!cover.isConnected);
                const info=document.querySelector('#about-page .info-item');
                if(info.hasAttribute('href')||!info.textContent.includes('WebKit'))throw Error('WebKit information offers an Android update link');
                info.click();
                if(opened.length)throw Error('About opened an external store');
                await acode.exec('copy-device-info');
                await wait(()=>copied.length>0);
                if(!copied.includes('iOS Version: '+device.version)||copied.includes('Android Version:'))throw Error('Incorrect platform in device report');
                if(!copied.includes('com.apple.WebKit'))throw Error('Device report lost native WebKit information');
                await stack.pop();
                await wait(()=>!document.getElementById('about-page')&&settingsElement.isConnected);
                await wait(()=>settingsElement.body.scrollTop===scrollTop);
                if(settingsElement.body!==body)throw Error('Back rebuilt the settings DOM');
                return true;
            } finally {
                system.openInBrowser=openBrowser;Bridge.clipboard.copy=copy;
                if(cover?.isConnected){cover.hide();await wait(()=>!cover.isConnected);}
                if(document.getElementById('about-page'))stack.pop();
                settingsPage?.hide();
            }
            """, arguments: [:], in: nil, contentWorld: .page) as? Bool
        XCTAssertEqual(result, true)
    }
}

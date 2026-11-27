import XCTest
import WebKit
@testable import runner

@MainActor
final class WebFullscreenTests: BridgeTestCase {
    func testShadowFullscreenPreservesIframeAndHitTargetsAcrossRepeatedEntryAndExit() async throws {
        let webView = try await editorWebView()
        let parent = webView.superview
        let fixture = AppFiles.shared.cache.appendingPathComponent("fullscreen-touch.html")
        try Data("<meta name='viewport' content='width=device-width, initial-scale=1'><body style='margin:0'><button id='touch' style='position:absolute;left:20px;top:100px;width:80px;height:44px'>Tap</button></body>".utf8).write(to: fixture)
        defer { try? FileManager.default.removeItem(at: fixture) }
        let result = try await webView.callAsyncJavaScript("""
            const host=document.createElement('div');host.style.cssText='transform:translate(40px,80px);width:100px;height:100px;overflow:hidden';document.body.append(host);
            const shadow=host.attachShadow({mode:'open'});
            const style=document.createElement('style');
            style.textContent=':host(:fullscreen){color:rgb(0,255,0)} section:fullscreen{background:rgb(0,255,0)} section:not(:fullscreen){background:rgb(255,0,0)}';
            const target=document.createElement('section');
            target.style.cssText='position:absolute!important;left:30px!important;width:80px!important;height:70px!important;margin:12px;padding:9px;border:3px solid red;transform:translateX(5px)';
            shadow.append(style,target);
            const iframe=document.createElement('iframe');iframe.allowFullscreen=true;iframe.style.cssText='width:100%;height:100%;border:0';
            const ready=new Promise(r=>iframe.onload=r);
            iframe.src='acode://localhost/__cache__/fullscreen-touch.html';
            target.append(iframe);await Promise.race([ready,new Promise((resolve,reject)=>setTimeout(()=>reject(Error('Iframe fixture failed to load')),5000))]);
            const original=iframe.contentWindow.document;original.body.dataset.retained='yes';
            if(!original.fullscreenEnabled||typeof original.body.requestFullscreen!=='function')throw Error('Iframe fullscreen API is unavailable');
            try {
                for(let n=0;n<3;n++) {
                    await target.requestFullscreen();
                    const rect=target.getBoundingClientRect();
                    if(document.fullscreenElement!==host||shadow.fullscreenElement!==target)throw Error('Shadow owner was not retargeted');
                    if(rect.x!==0||rect.y!==0||rect.width!==innerWidth||rect.height!==innerHeight)throw Error('Fullscreen viewport mismatch: '+JSON.stringify(rect));
                    if(getComputedStyle(target).backgroundColor!=='rgb(0, 255, 0)'||getComputedStyle(host).color!=='rgb(0, 255, 0)')throw Error('Shadow fullscreen CSS did not apply');
                    style.sheet.insertRule('section:fullscreen{background:rgb(0,0,255)}',style.sheet.cssRules.length);
                    if(getComputedStyle(target).backgroundColor!=='rgb(0, 0, 255)')throw Error('Dynamic fullscreen CSS did not apply');
                    style.sheet.deleteRule(style.sheet.cssRules.length-1);
                    if(iframe.contentWindow.document!==original||original.body.dataset.retained!=='yes')throw Error('Iframe reloaded');
                    const frame=iframe.getBoundingClientRect(),button=original.getElementById('touch').getBoundingClientRect();
                    const x=button.x+button.width/2,y=button.y+button.height/2;
                    if(shadow.elementFromPoint(frame.x+x,frame.y+y)!==iframe||original.elementFromPoint(x,y).id!=='touch')throw Error('Touch target shifted');
                    target.style.color='purple';target.style.setProperty('width','110px','important');
                    await new Promise(r=>requestAnimationFrame(r));
                    if(target.style.width!=='100%')throw Error('Plugin layout change escaped fullscreen');
                    await document.exitFullscreen();
                    if(target.style.width!=='110px'||target.style.height!=='70px'||target.style.left!=='30px'||target.style.marginTop!=='12px'||target.style.paddingTop!=='9px'||target.style.borderTopWidth!=='3px'||target.style.color!=='purple')throw Error('Plugin styles were lost on exit');
                    if(getComputedStyle(target).backgroundColor!=='rgb(255, 0, 0)'||host.hasAttribute('data-acode-fullscreen'))throw Error('Fullscreen CSS remained active on exit');
                    if(document.fullscreenElement||shadow.fullscreenElement||target.hasAttribute('popover'))throw Error('Fullscreen did not exit cleanly');
                }
                await target.requestFullscreen();
                host.remove();
                for(let n=0;n<100&&target.hasAttribute('popover');n++)await new Promise(r=>setTimeout(r,20));
                if(target.hasAttribute('popover'))throw Error('Removed owner kept fullscreen');
                return true;
            } finally {await document.exitFullscreen();host.remove();}
            """, arguments: [:], in: nil, contentWorld: .page) as? Bool
        XCTAssertEqual(result, true)
        XCTAssertTrue(webView.superview === parent)
        let controller = try controller(for: webView)
        XCTAssertFalse(controller.fullscreen.isFullscreen)
        XCTAssertNil(controller.fullscreen.requestedOrientation)
        XCTAssertEqual(webView.fullscreenState, .notInFullscreen)
        XCTAssertEqual(webView.frame.width, controller.view.safeAreaLayoutGuide.layoutFrame.width, accuracy: 1)
    }

    func testNavigationRestoresNativeFullscreenAndStatusBarPreference() async throws {
        let webView = try await editorWebView()
        let controller = try controller(for: webView)
        let hidden = controller.statusBarHidden
        controller.statusBarHidden = true
        defer { controller.statusBarHidden = hidden; controller.setThemeType(controller.themeType) }
        _ = try await webView.callAsyncJavaScript("await document.body.requestFullscreen();await acode.require('fullscreen').setBackHandler(()=>{});", arguments: [:], in: nil, contentWorld: .page)
        XCTAssertTrue(controller.fullscreen.isFullscreen)
        XCTAssertTrue(controller.prefersStatusBarHidden)
        webView.reload()
        try await Task.sleep(for: .milliseconds(200))
        _ = try await editorWebView()
        XCTAssertFalse(controller.fullscreen.isFullscreen)
        XCTAssertNil(controller.fullscreen.requestedOrientation)
        XCTAssertEqual(controller.statusBarHidden, true)
        XCTAssertTrue(controller.prefersStatusBarHidden)
        _ = try await webView.callAsyncJavaScript("await document.body.requestFullscreen()", arguments: [:], in: nil, contentWorld: .page)
        controller.fullscreen.back()
        try await wait(webView, until: "!document.fullscreenElement")
    }

    func testBackControlsRouteToHandlerAndRestoreDefaultExitAfterRelease() async throws {
        let webView = try await editorWebView()
        let controller = try controller(for: webView)
        let button = try XCTUnwrap(controller.view.subviews.compactMap { $0 as? UIButton }.first { $0.accessibilityIdentifier == "fullscreen-back" })
        let gesture = try XCTUnwrap(controller.view.gestureRecognizers?.compactMap { $0 as? UIScreenEdgePanGestureRecognizer }.first)
        XCTAssertTrue(button.isHidden)
        XCTAssertFalse(gesture.isEnabled)
        let theme = controller.themeType
        defer { controller.setThemeType(theme) }
        _ = try await webView.callAsyncJavaScript("""
            window.fullscreenBackCount=0;
            await document.body.requestFullscreen();
            await acode.require('fullscreen').setBackHandler(()=>window.fullscreenBackCount++);
            """, arguments: [:], in: nil, contentWorld: .page)
        controller.view.layoutIfNeeded()
        XCTAssertTrue(button.isHidden)
        XCTAssertTrue(gesture.isEnabled)
        XCTAssertEqual(button.bounds.size, CGSize(width: 44, height: 44))
        XCTAssertEqual(button.frame.minX, controller.view.safeAreaInsets.left + 8, accuracy: 1)
        XCTAssertEqual(button.frame.minY, controller.view.safeAreaInsets.top + 8, accuracy: 1)
        XCTAssertEqual(button.accessibilityLabel, "Back")
        controller.setThemeType("light")
        XCTAssertEqual(button.overrideUserInterfaceStyle, .light)
        controller.setThemeType("dark")
        XCTAssertEqual(button.overrideUserInterfaceStyle, .dark)
        button.sendActions(for: .touchUpInside)
        try await wait(webView, until: "window.fullscreenBackCount===1")
        _ = try await webView.callAsyncJavaScript("await acode.require('orientation').unlock()", arguments: [:], in: nil, contentWorld: .page)
        controller.fullscreen.back()
        try await wait(webView, until: "window.fullscreenBackCount===2")
        NotificationCenter.default.post(name: UIApplication.willResignActiveNotification, object: nil)
        XCTAssertFalse(button.isEnabled)
        XCTAssertFalse(gesture.isEnabled)
        controller.fullscreen.back()
        let pausedCount = try await webView.evaluateJavaScript("window.fullscreenBackCount") as? Int
        XCTAssertEqual(pausedCount, 2)
        NotificationCenter.default.post(name: UIApplication.didBecomeActiveNotification, object: nil)
        XCTAssertTrue(button.isEnabled)
        XCTAssertTrue(gesture.isEnabled)
        _ = try await webView.callAsyncJavaScript("await acode.require('fullscreen').setBackHandler(null)", arguments: [:], in: nil, contentWorld: .page)
        button.sendActions(for: .touchUpInside)
        try await wait(webView, until: "!document.fullscreenElement")
        XCTAssertTrue(button.isHidden)
        XCTAssertFalse(gesture.isEnabled)
        _ = try await webView.callAsyncJavaScript("await document.body.requestFullscreen()", arguments: [:], in: nil, contentWorld: .page)
        controller.fullscreen.back()
        try await wait(webView, until: "!document.fullscreenElement")
    }

    func testBackFailureCannotExitANewerFullscreenOwner() async throws {
        let webView = try await editorWebView()
        let controller = try controller(for: webView)
        _ = try await webView.callAsyncJavaScript("""
            await document.body.requestFullscreen();
            await acode.require('fullscreen').setBackHandler(()=>{throw Error('fixture');});
            """, arguments: [:], in: nil, contentWorld: .page)
        controller.fullscreen.back()
        try await wait(webView, until: "!document.fullscreenElement")
        _ = try await webView.callAsyncJavaScript("""
            await document.body.requestFullscreen();
            await acode.require('fullscreen').setBackHandler(()=>new Promise((resolve,reject)=>window.rejectFullscreenBack=reject));
            """, arguments: [:], in: nil, contentWorld: .page)
        controller.fullscreen.back()
        try await wait(webView, until: "!!window.rejectFullscreenBack")
        let retained = try await webView.callAsyncJavaScript("""
            await document.exitFullscreen();
            const target=document.createElement('div');target.id='new-fullscreen-owner';document.body.append(target);
            await target.requestFullscreen();
            window.fullscreenBackCount=0;
            await acode.require('fullscreen').setBackHandler(()=>window.fullscreenBackCount++);
            window.rejectFullscreenBack(Error('obsolete'));delete window.rejectFullscreenBack;
            await new Promise(r=>setTimeout(r,50));
            return document.fullscreenElement===target;
            """, arguments: [:], in: nil, contentWorld: .page) as? Bool
        XCTAssertEqual(retained, true)
        controller.fullscreen.back()
        try await wait(webView, until: "window.fullscreenBackCount===1")
        _ = try await webView.callAsyncJavaScript("await document.exitFullscreen();document.getElementById('new-fullscreen-owner').remove()", arguments: [:], in: nil, contentWorld: .page)
    }

    func testBackConsumesNativeDialogDismissalAndCancelledClose() async throws {
        let webView = try await editorWebView()
        let result = try await webView.callAsyncJavaScript("""
            const owner=document.createElement('div'),dialog=document.createElement('dialog');
            owner.append(dialog);document.body.append(owner);
            let calls=0,cancels=0,prevent=false;
            dialog.addEventListener('cancel',event=>{cancels++;if(prevent)event.preventDefault();});
            try {
                await owner.requestFullscreen();
                await acode.require('fullscreen').setBackHandler(()=>calls++);
                for(const blocked of [false,true]) {
                    prevent=blocked;dialog.showModal();
                    document.dispatchEvent(new Event('fullscreenbackbutton'));
                    await new Promise(r=>setTimeout(r,50));
                    if(dialog.open!==blocked||calls!==0||document.fullscreenElement!==owner)throw Error('Dialog Back fell through to the game callback');
                    dialog.close();
                }
                if(cancels!==2)throw Error('Dialog cancel was delivered twice');
                return true;
            } finally {dialog.close();await document.exitFullscreen();owner.remove();}
            """, arguments: [:], in: nil, contentWorld: .page) as? Bool
        XCTAssertEqual(result, true)
    }

    private func wait(_ webView: WKWebView, until expression: String) async throws {
        for _ in 0..<100 {
            if (try await webView.evaluateJavaScript(expression)) as? Bool == true { return }
            try await Task.sleep(for: .milliseconds(20))
        }
        XCTFail("Fullscreen did not reach: " + expression)
    }

    private func controller(for webView: WKWebView) throws -> WebViewController {
        var responder: UIResponder? = webView
        while responder != nil, !(responder is WebViewController) { responder = responder?.next }
        return try XCTUnwrap(responder as? WebViewController)
    }
}

import XCTest
import WebKit
@testable import runner

@MainActor
final class WebContextMenuTests: XCTestCase {
    func testNativeConfigurationPreservesTouchDeliveryAndCoversAllFrames() {
        let view = WKWebView()
        let menu = WebContextMenu(webView: view)
        XCTAssertTrue(view.gestureRecognizers?.contains(menu.gesture) == true)
        XCTAssertEqual(menu.gesture.minimumPressDuration, 0.45)
        XCTAssertEqual(menu.gesture.allowableMovement, 10)
        XCTAssertFalse(menu.gesture.cancelsTouchesInView)
        XCTAssertTrue(menu.gestureRecognizer(menu.gesture, shouldRecognizeSimultaneouslyWith: UIPanGestureRecognizer()))
        let script = view.configuration.userContentController.userScripts.first
        XCTAssertEqual(script?.injectionTime, .atDocumentStart)
        XCTAssertEqual(script?.isForMainFrameOnly, false)
        let preview = PreviewViewController(url: URL(string: "about:blank")!, theme: [:], console: false)
        XCTAssertTrue(preview.webView.configuration.userContentController.userScripts.contains { $0.source == WebContextMenu.script })
    }

    func testNativeDispatchUsesTheDOMTargetAndKeepsProgrammaticClicksWorking() async throws {
        let view = WKWebView(frame: CGRect(x: 0, y: 0, width: 400, height: 600))
        let menu = WebContextMenu(webView: view)
        view.loadHTMLString("""
            <meta name="viewport" content="width=device-width,initial-scale=1">
            <button id="button">Button</button>
            <a id="link" href="#" style="-webkit-touch-callout:default!important">Link</a>
            <input id="input" value="unchanged">
            <div id="host"></div>
            <iframe srcdoc="<button id='frame-button'>Frame</button>"></iframe>
            <script>
                window.events=[];window.clicks=0;
                document.getElementById('host').attachShadow({mode:'open'}).innerHTML='<button id="shadow-button">Shadow</button>';
                document.addEventListener('contextmenu',event=>{
                    const target=event.composedPath()[0];
                    events.push({id:target.id,x:event.clientX,y:event.clientY,button:event.button,bubbles:event.bubbles});
                    event.preventDefault();
                    target.click();
                });
                document.addEventListener('click',()=>clicks++);
                window.press=async target=>{
                    target.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,composed:true,
                        pointerType:'touch',isPrimary:true,pointerId:1,clientX:20,clientY:30}));
                    await new Promise(resolve=>setTimeout(resolve,500));
                };
            </script>
            """, baseURL: nil)
        try await waitFor(view, "typeof window.press==='function' && !!document.querySelector('iframe').contentWindow.acodeNativeContextMenu")
        for name in ["button", "link", "input", "shadow-button"] {
            _ = try await view.callAsyncJavaScript("""
                const target=document.getElementById(name)||document.getElementById('host').shadowRoot.getElementById(name);
                await press(target);
                """, arguments: ["name": name], in: nil, contentWorld: .page)
            menu.send()
            try await waitFor(view, "events.some(event=>event.id==='\(name)')")
            if name == "link" {
                let callout = try await view.evaluateJavaScript("document.getElementById('link').style.getPropertyValue('-webkit-touch-callout')") as? String
                XCTAssertEqual(callout, "none")
            }
        }
        let result = try await view.evaluateJavaScript("({events,clicks,input:document.getElementById('input').value})") as? [String: Any]
        let events = try XCTUnwrap(result?["events"] as? [[String: Any]])
        XCTAssertEqual(events.compactMap { $0["id"] as? String }, ["button", "link", "input", "shadow-button"])
        XCTAssertTrue(events.allSatisfy { ($0["x"] as? Int) == 20 && ($0["y"] as? Int) == 30 && ($0["button"] as? Int) == 2 && ($0["bubbles"] as? Bool) == true })
        XCTAssertEqual(result?["clicks"] as? Int, 4)
        XCTAssertEqual(result?["input"] as? String, "unchanged")
        let styles = try await view.evaluateJavaScript("""
            (()=>{const link=document.getElementById('link');
                link.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'touch',isPrimary:true,pointerId:1}));
                link.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerType:'touch',isPrimary:true,pointerId:1}));
                return {value:link.style.getPropertyValue('-webkit-touch-callout'),priority:link.style.getPropertyPriority('-webkit-touch-callout')};})();
            """) as? [String: String]
        XCTAssertEqual(styles?["value"], "default")
        XCTAssertEqual(styles?["priority"], "important")
        _ = try await view.callAsyncJavaScript("""
            const frame=document.querySelector('iframe').contentWindow;
            frame.events=[];
            frame.document.addEventListener('contextmenu',event=>frame.events.push(event.target.id));
            frame.document.getElementById('frame-button').dispatchEvent(new frame.PointerEvent('pointerdown',{
                bubbles:true,pointerType:'touch',isPrimary:true,pointerId:1}));
            await new Promise(resolve=>setTimeout(resolve,500));
            """, arguments: [:], in: nil, contentWorld: .page)
        menu.send()
        try await waitFor(view, "document.querySelector('iframe').contentWindow.events.length===1")
        let frameEvents = try await view.evaluateJavaScript("document.querySelector('iframe').contentWindow.events") as? [String]
        XCTAssertEqual(frameEvents, ["frame-button"])
    }

    private func waitFor(_ view: WKWebView, _ expression: String) async throws {
        for _ in 0..<100 {
            if (try? await view.evaluateJavaScript(expression)) as? Bool == true { return }
            try await Task.sleep(for: .milliseconds(50))
        }
        XCTFail("WebView did not settle: \(expression)")
        throw NSError(domain: "WebContextMenuTests", code: 1)
    }
}

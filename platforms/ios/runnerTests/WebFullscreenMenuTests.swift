import XCTest
import WebKit
@testable import runner

@MainActor
final class WebFullscreenMenuTests: BridgeTestCase {
    func testRepeatedBackDismissesMenuAfterFocusMovesOutsideIt() async throws {
        let webView = try await editorWebView()
        var responder: UIResponder? = webView
        while responder != nil, !(responder is WebViewController) { responder = responder?.next }
        let controller = try XCTUnwrap(responder as? WebViewController)
        _ = try await webView.callAsyncJavaScript("""
            const owner=document.createElement('div');owner.id='back-menu-fixture';document.body.append(owner);
            const shadow=owner.attachShadow({mode:'open'});
            shadow.innerHTML='<button id="game">Game</button><section role="dialog" aria-modal="true" hidden><button>Resume</button></section>';
            const menu=shadow.querySelector('section');
            owner.addEventListener('keydown',event=>{
                if(event.key==='Escape'&&!menu.hidden){menu.hidden=true;event.preventDefault();}
            });
            await owner.requestFullscreen();
            window.fixtureBackCount=0;
            await acode.require('fullscreen').setBackHandler(()=>{window.fixtureBackCount++;menu.hidden=false;menu.querySelector('button').focus();});
            """, arguments: [:], in: nil, contentWorld: .page)
        do {
            for _ in 0..<3 {
                controller.fullscreen.back()
                try await wait(webView, hidden: false)
                _ = try await webView.evaluateJavaScript("document.getElementById('back-menu-fixture').shadowRoot.getElementById('game').focus()")
                controller.fullscreen.back()
                try await wait(webView, hidden: true)
                XCTAssertTrue(controller.fullscreen.isFullscreen)
            }
            let count = try await webView.evaluateJavaScript("window.fixtureBackCount") as? Int
            XCTAssertEqual(count, 3, "Dismissal called Pause again instead of closing the menu")
        } catch {
            _ = try? await webView.callAsyncJavaScript("await document.exitFullscreen();document.getElementById('back-menu-fixture')?.remove();delete window.fixtureBackCount", arguments: [:], in: nil, contentWorld: .page)
            throw error
        }
        _ = try await webView.callAsyncJavaScript("await document.exitFullscreen();document.getElementById('back-menu-fixture').remove();delete window.fixtureBackCount", arguments: [:], in: nil, contentWorld: .page)
    }

    private func wait(_ webView: WKWebView, hidden: Bool) async throws {
        for _ in 0..<100 {
            let actual = try await webView.evaluateJavaScript("document.getElementById('back-menu-fixture').shadowRoot.querySelector('section').hidden") as? Bool
            if actual == hidden { return }
            try await Task.sleep(for: .milliseconds(20))
        }
        throw NSError(domain: "FullscreenMenuTests", code: 1, userInfo: [NSLocalizedDescriptionKey: "Back did not toggle menu visibility"])
    }
}

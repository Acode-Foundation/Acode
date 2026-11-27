import XCTest
import WebKit
@testable import runner

@MainActor
final class KeyboardLayoutTests: BridgeTestCase {
    func testPreviewOnlyChangesBottomAnchorWhenKeyboardVisibilityChanges() throws {
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let window = UIWindow(windowScene: scene)
        let controller = PreviewViewController(url: URL(string: "about:blank")!, theme: [:], console: false)
        window.rootViewController = controller
        window.isHidden = false
        defer { window.isHidden = true; window.rootViewController = nil }
        controller.view.layoutIfNeeded()

        func bottomConstraint() throws -> NSLayoutConstraint {
            try XCTUnwrap(controller.view.constraints.first {
                $0.firstItem === controller.content && $0.firstAttribute == .bottom && $0.isActive
            })
        }
        func notify(visible: Bool) {
            let bounds = controller.view.bounds
            let frame = CGRect(x: 0, y: visible ? bounds.height / 2 : bounds.height,
                               width: bounds.width, height: bounds.height / 2)
            NotificationCenter.default.post(name: UIResponder.keyboardWillChangeFrameNotification, object: nil,
                userInfo: [UIResponder.keyboardFrameEndUserInfoKey: controller.view.convert(frame, to: window.screen.coordinateSpace),
                           UIResponder.keyboardAnimationDurationUserInfoKey: 0])
        }

        notify(visible: false)
        let hidden = try bottomConstraint()
        XCTAssertTrue(hidden.secondItem === controller.view.safeAreaLayoutGuide)
        notify(visible: false)
        XCTAssertTrue(try bottomConstraint() === hidden)
        notify(visible: true)
        let shown = try bottomConstraint()
        XCTAssertTrue(shown.secondItem === controller.view.keyboardLayoutGuide)
        notify(visible: true)
        XCTAssertTrue(try bottomConstraint() === shown)
        controller.close()
        notify(visible: false)
        XCTAssertTrue(try bottomConstraint() === shown)
    }

    func testKeyboardResizeKeepsTheEditorCaretVisible() async throws {
        let webView = try await editorWebView()
        var responder: UIResponder? = webView
        while responder != nil, !(responder is WebViewController) { responder = responder?.next }
        let controller = try XCTUnwrap(responder as? WebViewController)
        let originalFrame = webView.frame
        addTeardownBlock { @MainActor in
            _ = try? await webView.callAsyncJavaScript("""
                const fixture=window.iosKeyboardFixture;
                if(fixture){
                    for(const [name,listener] of fixture.listeners) acode.require('keyboard').off(name,listener);
                    await fixture.file.remove(true);
                    delete window.iosKeyboardFixture;
                }
                """, arguments: [:], in: nil, contentWorld: .page)
            controller.view.endEditing(true)
            webView.frame = originalFrame
            NotificationCenter.default.post(name: UIResponder.keyboardWillHideNotification, object: nil)
            try await self.reloadWebView(webView)
        }
        _ = try await webView.callAsyncJavaScript("""
            const file = new (acode.require('EditorFile'))('ios-keyboard-layout.txt', {
                text:Array.from({length:200},(_,i)=>'keyboard line '+i).join('\\n'), isUnsaved:false
            });
            window.iosKeyboardFixture = {file, events:[], listeners:[]};
            file.makeActive();
            await new Promise(resolve=>setTimeout(resolve,200));
            const view = editorManager.editor;
            for(const name of ['keyboardShowStart','keyboardShow','keyboardHide']) {
                const listener=()=>iosKeyboardFixture.events.push(name);
                iosKeyboardFixture.listeners.push([name,listener]);
                acode.require('keyboard').on(name,listener);
            }
            view.focus();
            await new Promise(resolve=>setTimeout(resolve,500));
            view.dispatch({selection:{anchor:view.state.doc.length},scrollIntoView:true});
            for(let n=0;n<100;n++) {
                await new Promise(resolve=>setTimeout(resolve,50));
                const caret=view.coordsAtPos(view.state.selection.main.head), bounds=view.scrollDOM.getBoundingClientRect();
                if(caret && caret.top>=bounds.top && caret.bottom<=bounds.bottom) {
                    iosKeyboardFixture.events.length=0;
                    return true;
                }
            }
            throw Error('Fixture caret was not initially visible');
            """, arguments: [:], in: nil, contentWorld: .page)

        let height = min(350, controller.view.bounds.height / 2)
        let frame = CGRect(x: 0, y: controller.view.bounds.height - height,
                           width: controller.view.bounds.width, height: height)
        NotificationCenter.default.post(name: UIResponder.keyboardWillChangeFrameNotification, object: nil,
            userInfo: [UIResponder.keyboardFrameEndUserInfoKey: controller.view.convert(frame, to: nil)])
        // Resize WebKit directly so free-edition banner layout cannot undo the fixture.
        webView.frame.size.height -= min(200, webView.bounds.height / 3)
        let result = try await webView.callAsyncJavaScript("""
            await new Promise(resolve=>setTimeout(resolve,800));
            const view=editorManager.editor, caret=view.coordsAtPos(view.state.selection.main.head);
            const bounds=view.scrollDOM.getBoundingClientRect();
            const config=await new Promise((resolve,reject)=>Bridge.exec(resolve,reject,'System','get-configuration',[]));
            return {visible:!!caret && caret.top>=bounds.top && caret.bottom<=bounds.bottom,
                caret,bounds:bounds.toJSON(),config,events:iosKeyboardFixture.events,
                focused:view.contentDOM.contains(document.activeElement)};
            """, arguments: [:], in: nil, contentWorld: .page) as? [String: Any]
        XCTAssertEqual(result?["visible"] as? Bool, true, String(describing: result))
        XCTAssertTrue((result?["events"] as? [String])?.contains("keyboardShow") == true, String(describing: result))
    }
}

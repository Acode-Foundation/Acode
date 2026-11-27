import XCTest
import WebKit

@MainActor
final class HapticControlsTests: BridgeTestCase {
    func testQuickToolsSaveWithTapFeedbackEnabled() async throws {
        let webView = try await editorWebView()
        defer { webView.reload() }
        let saved = try await webView.callAsyncJavaScript("""
            const settings = acode.require('settings');
            const original = {
                vibrateOnTap: settings.value.vibrateOnTap,
                quickToolsTriggerMode: settings.value.quickToolsTriggerMode
            };
            const fsOperation = acode.require('fsOperation');
            const EditorFile = acode.require('EditorFile');
            const name = 'ios-haptic-save-' + Date.now() + '.txt';
            const uri = await fsOperation(Bridge.file.cacheDirectory).createFile(name, 'original');
            const fs = fsOperation(uri);
            const errors = [];
            const onError = event => { errors.push(event.message); event.preventDefault(); };
            let file;
            addEventListener('error', onError);
            try {
                if(typeof navigator.vibrate !== 'undefined') throw Error('Expected native iOS vibration API to be absent');
                file = new EditorFile(name, {uri, text:'original', isUnsaved:false});
                file.makeActive();
                // Unsaved settings compare against the persisted baseline; exercise it first.
                const modes = [original.quickToolsTriggerMode,
                    original.quickToolsTriggerMode === 'click' ? 'touch' : 'click'];
                for(const mode of modes) {
                    await settings.update({vibrateOnTap:true, quickToolsTriggerMode:mode}, false, false);
                    const content = 'saved from quick tools via ' + mode;
                    file.session.setValue(content);
                    await new Promise(resolve => setTimeout(resolve, 100));
                    const button = document.querySelector('footer [data-id="save"]');
                    if(!button || button.disabled) throw Error('Quick-tools Save unavailable');
                    button.scrollIntoView({block:'nearest', inline:'nearest'});
                    await new Promise(resolve => requestAnimationFrame(()=>requestAnimationFrame(resolve)));
                    if(mode === 'click') button.click();
                    else {
                        const rect = button.getBoundingClientRect();
                        const hit = document.elementFromPoint(rect.x + rect.width/2, rect.y + rect.height/2);
                        if(hit !== button) throw Error('Save touch target obstructed: ' + hit?.outerHTML + '; ' + JSON.stringify(rect));
                        const touch = new Touch({identifier:1, target:button,
                            clientX:rect.x + rect.width/2, clientY:rect.y + rect.height/2});
                        button.dispatchEvent(new TouchEvent('touchstart', {
                            bubbles:true, cancelable:true, touches:[touch], changedTouches:[touch]
                        }));
                        button.dispatchEvent(new TouchEvent('touchend', {
                            bubbles:true, cancelable:true, touches:[], changedTouches:[touch]
                        }));
                    }
                    if(errors.length) throw Error(mode + ': ' + errors.join('; '));
                    for(let n=0; file.isUnsaved && n<50; n++) await new Promise(resolve=>setTimeout(resolve,100));
                    if(file.isUnsaved || await fs.readFile('utf-8') !== content) throw Error(mode + ' did not save');
                }
                await new Promise((resolve,reject)=>Bridge.exec(resolve,reject,'Native','haptic',[]));
                return true;
            } finally {
                removeEventListener('error', onError);
                await settings.update(original, false, false);
                if(file) await file.remove(true);
                await fs.delete();
            }
            """, arguments: [:], in: nil, contentWorld: .page) as? Bool
        XCTAssertEqual(saved, true)
    }
}

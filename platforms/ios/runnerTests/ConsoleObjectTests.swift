import XCTest
import WebKit
@testable import runner

extension PreviewBrowserTests {
    func testStandaloneConsoleInspectsObjectsAndRecoversAfterCancellation() async throws {
        let app = try await editorWebView()
        var responder: UIResponder? = app
        while responder != nil, !(responder is WebViewController) { responder = responder?.next }
        let controller = try XCTUnwrap(responder as? WebViewController)
        _ = try await app.evaluateJavaScript("acode.exec('console')")
        let browser = try await presentedBrowser(controller)
        defer { browser.dismiss(animated: false) }
        try await waitForPage(browser.webView, expression: "Boolean(document.querySelector('#__c-input'))")
        let result = try await browser.webView.callAsyncJavaScript("""
            const input=document.querySelector('#__c-input');
            const wait=async check=>{for(let n=0;n<100;n++){if(check())return;await new Promise(r=>setTimeout(r,20));}throw Error('Console command did not finish');};
            const submit=async code=>{
                console.clear();input.value=code;
                input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
                await wait(()=>!input.disabled&&document.querySelector('c-message[log-level="log"],c-message[log-level="error"]'));
            };
            await submit('({count:42,nested:{enabled:true}})');
            document.querySelector('c-message[log-level="log"] c-type').click();
            const row=[...document.querySelectorAll('c-line')].find(row=>row.firstElementChild?.textContent==='count:');
            const key=row.querySelector('c-key').getBoundingClientRect(),value=row.querySelector('c-text').getBoundingClientRect();
            const inline=Math.abs(key.top-value.top)<2&&value.left>=key.right;
            const nested=[...document.querySelectorAll('c-line')].find(row=>row.firstElementChild?.textContent==='nested:');
            nested.querySelector('c-type').click();
            const expanded=nested.textContent.includes('enabled:')&&nested.textContent.includes('true');
            const hasContextSelector=!!document.querySelector('.__c-context');
            input.value='while(true){}';
            input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
            const stop=document.querySelector('[aria-label="Stop JavaScript execution"]');
            await wait(()=>input.disabled&&!stop.hidden);
            stop.click();
            await wait(()=>!input.disabled);
            await submit('21*2');
            const workerRecovered=document.querySelector('c-message[log-level="log"] c-text')?.textContent==='42';
            await submit('typeof window');
            const windowType=document.querySelector('c-message[log-level="log"] c-text')?.textContent;
            const error=document.querySelector('c-message[log-level="error"]')?.textContent;
            input.blur();
            return {inline,expanded,error:error||'',windowType,hasContextSelector,workerRecovered};
            """, arguments: [:], in: nil, contentWorld: .page) as? [String: Any]
        XCTAssertEqual(result?["inline"] as? Bool, true, "Property keys and values must share a line")
        XCTAssertEqual(result?["expanded"] as? Bool, true)
        XCTAssertEqual(result?["error"] as? String, "")
        XCTAssertEqual(result?["windowType"] as? String, "undefined")
        XCTAssertEqual(result?["hasContextSelector"] as? Bool, false)
        XCTAssertEqual(result?["workerRecovered"] as? Bool, true)
        try await Task.sleep(for: .milliseconds(300))
        _ = try await browser.webView.evaluateJavaScript("document.querySelector('c-output').scrollTop=0")
        try await Task.sleep(for: .milliseconds(200))
        attachScreenshot(browser, name: "console-worker-object")
    }
}

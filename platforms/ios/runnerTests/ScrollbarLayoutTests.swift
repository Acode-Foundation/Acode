import XCTest
import WebKit

@MainActor
final class ScrollbarLayoutTests: BridgeTestCase {
    func testHiddenScrollbarsKeepScrollingAndListsRetainTheirIndicators() async throws {
        let webView = try await editorWebView()
        let result = try await webView.callAsyncJavaScript("""
            const fixtures=[];
            try {
                const results=[];
                for(const className of ['open-file-list editor-pane-tabs','no-scroll','list']) {
                    const scroller=document.createElement('ul');
                    scroller.className=className;
                    scroller.style.cssText='position:fixed;top:100px;left:0;width:160px;height:90px;overflow:auto';
                    const content=document.createElement('li');
                    content.style.cssText='width:800px;min-width:800px;height:400px;flex-shrink:0';
                    scroller.appendChild(content);document.body.appendChild(scroller);fixtures.push(scroller);
                    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
                    scroller.scrollLeft=80;scroller.scrollTop=60;
                    results.push({width:getComputedStyle(scroller).scrollbarWidth,horizontal:scroller.scrollLeft>0,
                        vertical:scroller.scrollTop>0});
                }
                return results;
            } finally {fixtures.forEach(element=>element.remove());}
            """, arguments: [:], in: nil, contentWorld: .page) as? [[String: Any]]
        XCTAssertEqual(result?.count, 3)
        XCTAssertEqual(result?[0]["width"] as? String, "none")
        XCTAssertEqual(result?[1]["width"] as? String, "none")
        XCTAssertEqual(result?[2]["width"] as? String, "auto")
        XCTAssertEqual(result?.compactMap { $0["horizontal"] as? Bool }, [true, true, true])
        XCTAssertEqual(result?[1]["vertical"] as? Bool, true)
    }
}

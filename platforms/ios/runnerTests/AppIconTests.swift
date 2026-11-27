import XCTest
@testable import runner

@MainActor
final class AppIconTests: BridgeTestCase {
    func testEveryPickerIconIsPackagedForIPhoneAndIPad() throws {
        let previews = try FileManager.default.contentsOfDirectory(at: Bundle.main.bundleURL.appendingPathComponent("bundle/icons"), includingPropertiesForKeys: nil)
        let expected = Set(previews.filter { $0.lastPathComponent.hasPrefix("ic_acode_") && $0.pathExtension == "svg" && $0.lastPathComponent != "ic_acode_default.svg" }.map { $0.deletingPathExtension().lastPathComponent })
        XCTAssertEqual(expected.count, 15)
        let metadata = try XCTUnwrap(PropertyListSerialization.propertyList(from: Data(contentsOf: Bundle.main.bundleURL.appendingPathComponent("Info.plist")), format: nil) as? [String: Any])
        for key in ["CFBundleIcons", "CFBundleIcons~ipad"] {
            let icons = try XCTUnwrap(metadata[key] as? [String: Any])
            let alternatives = try XCTUnwrap(icons["CFBundleAlternateIcons"] as? [String: Any])
            XCTAssertEqual(Set(alternatives.keys), expected)
            XCTAssertNotNil(icons["CFBundlePrimaryIcon"])
        }
        XCTAssertTrue(UIApplication.shared.supportsAlternateIcons)
    }

    func testPublicIconNoOpAndUnknownIconRejection() async throws {
        let webView = try await appWebView()
        let current = UIApplication.shared.alternateIconName?.replacingOccurrences(of: "ic_acode_", with: "") ?? "default"
        let result = try await webView.callAsyncJavaScript("""
            const call=id=>new Promise((resolve,reject)=>system.setAppIcon(id,resolve,reject));
            await call(current);
            try{await call('unknown-icon');throw Error('Unknown icon accepted');}
            catch(error){if(error!=='Unknown app icon: unknown-icon')throw error;}
            return true;
            """, arguments: ["current": current], in: nil, contentWorld: .page) as? Bool
        XCTAssertEqual(result, true)
    }

    func testPickerControlsHaveVisibleTouchTargets() async throws {
        let webView = try await appWebView()
        let result = try await webView.callAsyncJavaScript("""
            for(let n=0;app.classList.contains('loading')&&n<150;n++)await new Promise(r=>setTimeout(r,100));
            if(app.classList.contains('loading'))throw Error('App startup did not finish');
            await acode.exec('open','settings');
            document.querySelector('[data-key="appIcon"]').click();
            await new Promise(r=>setTimeout(r,300));
            const dialog=document.querySelector('.app-icon-dialog');
            try {
                const buttons=[...dialog.querySelectorAll('[data-icon]')];
                const targets=buttons.map(button=>{
                    const r=button.getBoundingClientRect();
                    const element=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
                    const hit=element?.closest('[data-icon]');
                    return {id:button.dataset.icon,x:r.x,y:r.y,width:r.width,height:r.height,hit:hit?.dataset.icon,element:element?.outerHTML.slice(0,200)};
                });
                return {targets,correct:targets.length===16&&targets.every(t=>t.hit===t.id)};
            }finally{dialog.querySelector('.button-container button').click();}
            """, arguments: [:], in: nil, contentWorld: .page) as? [String: Any]
        XCTAssertEqual(result?["correct"] as? Bool, true, String(describing: result))
    }
}

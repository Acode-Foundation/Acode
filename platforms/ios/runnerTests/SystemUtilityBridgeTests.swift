import XCTest

@MainActor
final class SystemUtilityBridgeTests: BridgeTestCase {
    func testLegacyChecksumAndCacheActionsPreserveTheirPublicContract() async throws {
        let webView = try await appWebView()
        let result = try await webView.callAsyncJavaScript("""
            const call=(action,args=[])=>new Promise((resolve,reject)=>Bridge.exec(resolve,reject,'System',action,args));
            for(const text of ['', 'Acode ✓ 日本語']) {
                const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
                const expected=[...new Uint8Array(bytes)].map(n=>n.toString(16).padStart(2,'0')).join('');
                if(await call('checksumText',[text])!==expected)throw Error('Checksum mismatch');
            }
            const key='ios-cache-fixture-'+crypto.randomUUID();
            try {
                localStorage.setItem(key,'retain');
                if(await call('clear-cache')!=='Cache cleared')throw Error('Cache response changed');
                if(localStorage.getItem(key)!=='retain')throw Error('Cache clearing removed app data');
                await call('clearCache');
                return true;
            }finally{localStorage.removeItem(key);}
            """, arguments: [:], in: nil, contentWorld: .page) as? Bool
        XCTAssertEqual(result, true)
    }
}

import XCTest
import WebKit

@MainActor
final class NetworkBridgeTests: BridgeTestCase {
    func testNativeWebSocket() async throws {
        let server = try HTTPFixture(websocket: true)
        try await server.start()
        defer { server.stop() }
        let webView = try await appWebView()
        let result = try await webView.callAsyncJavaScript("""
            await new Promise(resolve => document.addEventListener('deviceready', resolve));
            const socket = await Bridge.websocket.connect(origin.replace('http:','ws:'), ['acode-test'], {'X-Acode-Fixture':'test'}, 'arraybuffer');
            await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
            const echo = value=>new Promise((resolve,reject)=>{socket.onmessage=e=>resolve(e.data);socket.onerror=reject;socket.send(value);});
            if(await echo('Acode ✓') !== 'Acode ✓') throw Error('Socket text changed');
            const bytes = [0,127,128,159,255];
            if([...new Uint8Array(await echo(new Uint8Array(bytes).buffer))].join() !== bytes.join()) throw Error('Socket bytes changed');
            socket.binaryType='blob';
            if(await echo(new TextEncoder().encode('binary text').buffer) !== 'binary text') throw Error('Legacy binary text changed');
            const close = new Promise((resolve,reject)=>{socket.onclose=e=>resolve(e.code);socket.onerror=reject;});
            socket.close(1000, 'done');
            if(await close !== 1000) throw Error('Close code changed');
            if((await Bridge.websocket.listClients()).includes(socket.instanceId)) throw Error('Socket leaked');
            return true;
            """, arguments: ["origin": server.origin], in: nil, contentWorld: .page) as? Bool
        XCTAssertEqual(result, true)
    }

    func testNativeNetworking() async throws {
        let server = try HTTPFixture()
        try await server.start()
        defer { server.stop() }
        let webView = try await appWebView()
        let result = try await webView.callAsyncJavaScript("""
            await new Promise(resolve => document.addEventListener('deviceready', resolve));
            const request = (path, options = {}) => new Promise((resolve, reject) => Bridge.http.sendRequest(origin + path, options, resolve, reject));
            const bytes = [0,127,128,159,255];
            const binary = await request('/bytes', {responseType:'arraybuffer'});
            if ([...new Uint8Array(binary.data)].join() !== bytes.join()) throw Error('HTTP binary changed');
            const unicode = 'Acode ✓ 日本語';
            if ((await request('/echo', {method:'post', serializer:'utf8', data:unicode})).data !== unicode) throw Error('UTF8 body changed');
            const raw = await request('/echo', {method:'post', serializer:'raw', data:new Uint8Array(bytes).buffer, responseType:'arraybuffer'});
            if ([...new Uint8Array(raw.data)].join() !== bytes.join()) throw Error('Raw body changed');
            if ((await request('/echo', {method:'post', serializer:'urlencoded', data:{code:'a b+c'}})).data !== 'code=a%20b%2Bc') throw Error('Form body changed');
            if ((await request('/redirect', {responseType:'arraybuffer'})).status !== 200) throw Error('Redirect failed');
            try { await request('/redirect', {followRedirect:false}); throw Error('Redirect followed'); } catch(e) { if(e.status !== 302) throw e; }
            try { await request('/error'); throw Error('HTTP error resolved'); } catch(e) { if(e.status !== 422 || e.error !== 'invalid request') throw e; }
            await request('/cookie');
            if (!(await request('/cookie-check')).data.includes('session=fixture')) throw Error('Cookie missing');
            const destination = Bridge.file.cacheDirectory + 'network-fixture.bin';
            const entry = await request('/bytes', {method:'download', filePath:destination});
            try { if ([...new Uint8Array(await (await fetch(entry.toInternalURL())).arrayBuffer())].join() !== bytes.join()) throw Error('Download changed'); }
            finally { await new Promise((resolve,reject)=>entry.remove(resolve,reject)); }
            let requestId;
            const aborted = new Promise((resolve,reject)=>{ requestId=Bridge.http.sendRequest(origin+'/slow',{},reject,resolve); });
            await new Promise((resolve,reject)=>Bridge.http.abort(requestId,resolve,reject));
            if((await aborted).status !== -8) throw Error('Abort status changed');
            const stream = await system.httpStream(origin+'/stream', {chunkSize:4096});
            await new Promise(resolve=>setTimeout(resolve,100));
            const streamed = new Uint8Array(await stream.arrayBuffer());
            if(streamed.length !== 524288 || streamed.some((b,i)=>b!==i%256)) throw Error('Stream truncated or corrupted');
            const controller = new AbortController();
            const cancelled = system.httpStream(origin+'/slow', {signal:controller.signal}).then(()=>false,e=>e.name==='AbortError');
            controller.abort();
            if(!await cancelled) throw Error('Stream cancellation failed');
            return true;
            """, arguments: ["origin": server.origin], in: nil, contentWorld: .page) as? Bool
        XCTAssertEqual(result, true)
    }

}

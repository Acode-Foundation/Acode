import XCTest
import WebKit
@testable import runner

final class LocalHTTPParserTests: XCTestCase {
    func testFragmentedUnicodeAndBinaryBodies() throws {
        let body = Data([0, 128, 255]) + Data("✓\r\n\r\nend".utf8)
        let head = "POST /a%20b%23%E2%9C%93?code=a%2Bb HTTP/1.1\r\nHost: localhost\r\nContent-Length: \(body.count)\r\n\r\n"
        var parser = LocalHTTPParser()
        let bytes = Data(head.utf8) + body
        var request: LocalHTTPRequest?
        for (index, byte) in bytes.enumerated() {
            request = try parser.append(Data([byte]))
            if index < bytes.count - 1 { XCTAssertNil(request) }
        }
        XCTAssertEqual(request?.body, body)
        XCTAssertEqual(request?.payload["path"] as? String, "/a b#✓")
        XCTAssertEqual(request?.payload["query"] as? String, "code=a%2Bb")
    }

    func testChunkedUploadAndAmbiguousFraming() throws {
        var parser = LocalHTTPParser()
        let wire = "POST / HTTP/1.1\r\nHost: localhost\r\nTransfer-Encoding: chunked\r\nExpect: 100-continue\r\n\r\n3;x=1\r\nabc\r\n4\r\ndefg\r\n0\r\nX-Final: done\r\n\r\n"
        var request: LocalHTTPRequest?
        for byte in wire.utf8 { request = try parser.append(Data([byte])) }
        XCTAssertEqual(request?.body, Data("abcdefg".utf8))
        XCTAssertTrue(parser.expectsContinue)
        for headers in ["Content-Length: -1", "Content-Length: 1\r\nContent-Length: 2", "Transfer-Encoding: chunked\r\nContent-Length: 1", "Transfer-Encoding: gzip", "Content-Length: 999999999", "Host: a\r\nHost: b"] {
            var invalid = LocalHTTPParser()
            XCTAssertThrowsError(try invalid.append(Data("POST / HTTP/1.1\r\n\(headers)\r\n\r\n".utf8)))
        }
    }
}

@MainActor
final class PreviewServerTests: BridgeTestCase {
    func testImmediateRestartKeepsTheReplacementRequestHandler() async throws {
        let webView = try await appWebView()
        let port = Int.random(in: 49152...60000)
        let result = try await webView.callAsyncJavaScript("""
            const origin='http://127.0.0.1:'+port;
            let server;
            try {
                for(let generation=0;generation<4;generation++) {
                    await new Promise((resolve,reject)=>{
                        server?.stop(null,reject);
                        const next=CreateServer(port,resolve,reject);
                        next.setOnRequestHandler(request=>next.send(request.requestId,{
                            status:200,body:'generation-'+generation,headers:{'Content-Type':'text/plain'}
                        }),reject);
                        server=next;
                    });
                    const response=await new Promise((resolve,reject)=>Bridge.http.sendRequest(origin,{},resolve,reject));
                    if(response.data!=='generation-'+generation)throw Error('Stale preview handler: '+response.data);
                }
                return true;
            } catch(error) {throw Error(error?.message || JSON.stringify(error));}
            finally {if(server)await new Promise(resolve=>server.stop(resolve,resolve));}
            """, arguments: ["port": port], in: nil, contentWorld: .page) as? Bool
        XCTAssertEqual(result, true)
    }

    func testServerBridgeFilesRangesAndParallelRequests() async throws {
        let webView = try await appWebView()
        let file = AppFiles.shared.cache.appendingPathComponent("preview # ✓.bin")
        let bytes = Data((0..<524288).map { UInt8($0 % 256) })
        try bytes.write(to: file)
        defer { try? FileManager.default.removeItem(at: file) }
        let port = Int.random(in: 49152...60000)
        let result = try await webView.callAsyncJavaScript("""
            await new Promise(resolve=>document.addEventListener('deviceready',resolve));
            const call=(action,args)=>new Promise((resolve,reject)=>Bridge.exec(resolve,reject,'Server',action,args));
            let server;
            await new Promise((resolve,reject)=>{
                server=CreateServer(port,resolve,reject);
                server.setOnRequestHandler(request=>{
                    if(request.path==='/file') server.send(request.requestId,{path:file});
                    else if(request.path==='/missing') server.send(request.requestId,{path:file+'missing'});
                    else server.send(request.requestId,{status:201,headers:{'Content-Type':'application/json'},body:JSON.stringify(request)});
                },reject);
            });
            const origin='http://127.0.0.1:'+port;
            const request=(path,options={})=>new Promise((resolve,reject)=>Bridge.http.sendRequest(origin+path,options,resolve,reject));
            try {
                const echo=JSON.parse((await request('/a%20b%23%E2%9C%93?code=a%2Bb',{method:'post',serializer:'utf8',data:'Acode ✓',headers:{'X-Example':'value'}})).data);
                if(echo.body!=='Acode ✓'||echo.path!=='/a b#✓'||echo.query!=='code=a%2Bb'||echo.headers['x-example']!=='value'||echo.method!=='POST') throw Error('Request changed');
                const responses=await Promise.all(Array.from({length:5},()=>request('/file',{responseType:'arraybuffer'})));
                for(const response of responses) {
                    const bytes=new Uint8Array(response.data);
                    if(bytes.length!==524288||bytes.some((v,i)=>v!==i%256)) throw Error('File truncated');
                }
                const range=await request('/file',{headers:{Range:'bytes=127-129'},responseType:'arraybuffer'});
                if(range.status!==206||[...new Uint8Array(range.data)].join()!=='127,128,129'||range.headers['content-range']!=='bytes 127-129/524288') throw Error('Range changed');
                const suffix=await request('/file',{headers:{Range:'bytes=-2'},responseType:'arraybuffer'});
                if([...new Uint8Array(suffix.data)].join()!=='254,255') throw Error('Suffix range changed');
                const head=await request('/file',{method:'head'});
                if(head.data!==''||head.headers['content-length']!=='524288') throw Error('HEAD changed');
                const conditional=await request('/file',{headers:{'If-None-Match':responses[0].headers.etag}}).catch(error=>error);
                if(conditional.status!==304) throw Error('Cache validator ignored');
                const invalid=await request('/file',{headers:{Range:'bytes=524288-'}}).catch(error=>error);
                if(invalid.status!==416) throw Error('Unsatisfiable range accepted');
                const missing=await request('/missing').catch(error=>error);
                if(missing.status!==404) throw Error('Missing file status changed');
            } finally { await call('stop',[port]); }
            await call('start',[port]);
            await call('stop',[port]);
            for(const invalid of [-1,0,65536]) {
                let failed=false; try { await call('start',[invalid]); } catch { failed=true; }
                if(!failed) throw Error('Invalid port accepted');
            }
            return true;
            """, arguments: ["port": port, "file": file.absoluteString], in: nil, contentWorld: .page) as? Bool
        XCTAssertEqual(result, true)
    }
}

import XCTest
import WebKit
@testable import runner

@MainActor
final class SchemeRequestTests: XCTestCase {
    func testBrowserAPITransportPreservesBodiesCookiesErrorsAndCancellation() async throws {
        let fixture = try HTTPFixture()
        try await fixture.start()
        defer { fixture.stop() }
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(FixtureSchemeHandler(origin: URL(string: fixture.origin)!), forURLScheme: "acode")
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.load(URLRequest(url: URL(string: "acode://localhost/")!))
        for _ in 0..<100 {
            if !webView.isLoading, webView.url != nil { break }
            try await Task.sleep(for: .milliseconds(100))
        }
        let result = try await webView.callAsyncJavaScript("""
            const api = 'acode://localhost/__api__/';
            const text = 'body ✓ # %';
            const echo = await fetch(api+'echo', {method:'POST',body:text});
            if (await echo.text() !== text) throw Error('POST body changed');
            const bytes = new Uint8Array([0,128,159,255]);
            const binary = await fetch(api+'echo', {method:'PATCH',body:bytes});
            if ([...new Uint8Array(await binary.arrayBuffer())].join() !== bytes.join()) throw Error('Binary body changed');
            const form = new FormData();
            form.append('name',text); form.append('file',new Blob([text]),'fixture.txt');
            const request = new Request(api+'echo', {method:'POST',body:form});
            const formBytes = await request.arrayBuffer();
            const upload = await new Promise((resolve,reject)=>{
                const xhr = new XMLHttpRequest();
                xhr.open('POST', api+'echo'); xhr.responseType='text';
                xhr.setRequestHeader('Content-Type', request.headers.get('Content-Type'));
                xhr.onload=()=>resolve(xhr.response); xhr.onerror=()=>reject(Error('XHR failed'));
                xhr.send(formBytes);
            });
            if(!upload.includes(text) || !upload.includes('fixture.txt')) throw Error('Multipart upload changed');
            const credentials = {'X-Acode-Credentials':'include'};
            await fetch(api+'cookie', {headers:credentials});
            const withCookies = await (await fetch(api+'cookie-check', {headers:credentials})).text();
            const withoutCookies = await (await fetch(api+'cookie-check')).text();
            if(!withCookies.includes('session=fixture') || withoutCookies.includes('session=fixture')) throw Error('Cookie credentials ignored: '+JSON.stringify({withCookies,withoutCookies}));
            const failure = await fetch(api+'error');
            if(failure.status !== 422 || await failure.text() !== 'invalid request') throw Error('HTTP failure lost');
            const empty = await fetch(api+'empty');
            if(empty.status !== 204 || await empty.text() !== '') throw Error('Empty response lost');
            const redirect = await fetch(api+'redirect');
            if(!redirect.headers.get('X-Acode-Response-URL').endsWith('/bytes')) throw Error('Redirect metadata lost');
            const manual = await fetch(api+'redirect', {redirect:'manual',headers:{'X-Acode-Redirect':'manual'}});
            if(manual.type !== 'opaqueredirect' || manual.status !== 0) throw Error('Manual redirect changed: '+manual.type+' '+manual.status);
            let denied=false;
            try { await fetch(api+'external-redirect'); } catch { denied=true; }
            if(!denied) throw Error('Cross-origin redirect allowed');
            const controller = new AbortController();
            const pending = fetch(api+'slow',{signal:controller.signal});
            setTimeout(()=>controller.abort(),10);
            try { await pending; throw Error('Abort ignored'); } catch(error) { if(error.name !== 'AbortError') throw error; }
            return true;
            """, arguments: [:], in: nil, contentWorld: .page) as? Bool
        XCTAssertEqual(result, true)
        for cookie in HTTPCookieStorage.shared.cookies ?? [] where cookie.domain == "127.0.0.1" && cookie.name == "session" {
            HTTPCookieStorage.shared.deleteCookie(cookie)
        }
    }

    func testRedirectHookForwardsResponseCookieAndPreservesAccountToken() async throws {
        let fixture = try HTTPFixture()
        try await fixture.start()
        defer { fixture.stop() }
        var request = URLRequest(url: URL(string: fixture.origin + "/cookie-redirect")!)
        request.httpShouldHandleCookies = false
        request.setValue("token=account-fixture", forHTTPHeaderField: "Cookie")
        let transport = HTTPTransport(request: request, followRedirects: true, connectTimeout: 5, readTimeout: 5)
        defer { transport.cancel() }
        let redirected = expectation(description: "Redirect cookie callback")
        redirected.assertForOverFulfill = true
        transport.onRedirect = { response, next in
            XCTAssertEqual(response.statusCode, 302)
            let header = try XCTUnwrap(response.value(forHTTPHeaderField: "Set-Cookie"))
            let cookies = HTTPCookie.cookies(withResponseHeaderFields: ["Set-Cookie": header], for: try XCTUnwrap(response.url))
            let cookie = try XCTUnwrap(HTTPCookie.requestHeaderFields(with: cookies)["Cookie"])
            let account = try XCTUnwrap(next.value(forHTTPHeaderField: "Cookie"))
            next.setValue(cookie + "; " + account, forHTTPHeaderField: "Cookie")
            redirected.fulfill()
        }
        let data: Data = try await withCheckedThrowingContinuation { continuation in
            var body = Data()
            transport.onData = { body.append($0) }
            transport.onComplete = { error in
                if let error { continuation.resume(throwing: error) }
                else { continuation.resume(returning: body) }
            }
            transport.start()
        }
        await fulfillment(of: [redirected], timeout: 1)
        let headers = String(decoding: data, as: UTF8.self).components(separatedBy: "\r\n")
        let header = try XCTUnwrap(headers.first { $0.lowercased().hasPrefix("cookie:") })
        let cookies = Set(header.dropFirst("Cookie:".count).components(separatedBy: ";").map { $0.trimmingCharacters(in: .whitespaces) })
        XCTAssertEqual(cookies, ["session=redirect-fixture", "token=account-fixture"])
    }
}

private final class FixtureSchemeHandler: NSObject, WKURLSchemeHandler {
    private let api: AppAPIHandler
    init(origin: URL) { api = AppAPIHandler(origin: origin) }
    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        if task.request.url?.path != "/" { api.start(task); return }
        let data = Data("<html></html>".utf8)
        task.didReceive(URLResponse(url: task.request.url!, mimeType: "text/html", expectedContentLength: data.count, textEncodingName: "UTF-8"))
        task.didReceive(data); task.didFinish()
    }
    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) { api.stop(task) }
}

import CryptoKit
import WebKit
import XCTest
@testable import runner

final class AuthenticationTests: XCTestCase {
    private var auth: AppAuthentication!

    override func setUpWithError() throws { auth = AppAuthentication(namespace: "test-auth-" + UUID().uuidString) }
    override func tearDownWithError() throws { try auth.secrets.clear() }

    @MainActor
    func testAuthenticationLinksDoNotReachPluginIntentObservers() {
        let links = IncomingLinks()
        var received: URL?
        links.authenticationHandler = { received = $0 }
        let leaked = expectation(description: "Authentication URL reached plugin observers")
        leaked.isInverted = true
        let observer = NotificationCenter.default.addObserver(forName: .acodeDeepLink, object: nil, queue: nil) { _ in leaked.fulfill() }
        defer { NotificationCenter.default.removeObserver(observer) }
        let url = URL(string: "acode://auth/callback?code=fixture&state=fixture")!
        links.receive(url)
        XCTAssertEqual(received, url)
        wait(for: [leaked], timeout: 0.01)
    }

    func testLoginChallengeAndOneTimeExchangeMatchTheExistingServerProtocol() throws {
        for origin in ["https://acode.app", "https://dev.acode.app"] {
            let url = try auth.begin(baseURL: origin, version: 1011)
            let items = try XCTUnwrap(URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems)
            let values = Dictionary(uniqueKeysWithValues: items.map { ($0.name, $0.value!) })
            XCTAssertEqual(url.host, URL(string: origin)?.host)
            XCTAssertEqual(url.path, "/login")
            XCTAssertEqual(values["authFlow"], "app-code")
            XCTAssertEqual(values["redirect"], "app")
            XCTAssertEqual(values["src"], "ios")
            XCTAssertEqual(values["appVersionCode"], "1011")
            XCTAssertEqual(values["state"]?.count, 48)
            let callback = URL(string: "acode://auth/callback?state=\(values["state"]!)&code=test-code")!
            let request = try auth.consume(callback)
            let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: request.httpBody!) as? [String: String])
            XCTAssertEqual(request.url?.absoluteString, origin + "/api/user/app-token/exchange")
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(payload["code"], "test-code")
            XCTAssertEqual(payload["state"], values["state"])
            XCTAssertEqual(payload["verifier"]?.count, 64)
            let digest = SHA256.hash(data: Data(payload["verifier"]!.utf8)).map { String(format: "%02x", $0) }.joined()
            XCTAssertEqual(values["challenge"], digest)
            XCTAssertThrowsError(try auth.consume(callback))
            XCTAssertEqual(try auth.secrets.get("pending_login"), "")
        }
    }

    func testRejectsForgedCallbacksUntrustedOriginsAndInvalidCookieTokens() throws {
        for value in ["http://acode.app", "https://acode.app.evil.test", "https://acode.app:8443", "https://user@acode.app", "https://acode.app/path", "http://dev.acode.app", "https://dev.acode.app.evil.test", "https://dev.acode.app:8443", "https://dev.acode.app?next=other"] {
            XCTAssertThrowsError(try auth.begin(baseURL: value, version: 1))
        }
        let url = try auth.begin(baseURL: "https://acode.app", version: 1)
        let state = URLComponents(url: url, resolvingAgainstBaseURL: false)!.queryItems!.first { $0.name == "state" }!.value!
        for value in ["acode://auth/callback?state=wrong&code=test", "acode://auth/callback?state=\(state)&code=", "acode://plugin/callback?state=\(state)&code=test", "acode://auth/callback?state=\(state)&state=\(state)&code=test"] {
            XCTAssertThrowsError(try auth.consume(URL(string: value)!))
        }
        for token in ["", "x;other=y", "x\r\ny", "unicode✓", "a b"] { XCTAssertThrowsError(try auth.save(token)) }
        try auth.save("fixture.token-123_value")
        XCTAssertEqual(try auth.secrets.get("auth_token"), "fixture.token-123_value")
        try auth.logout()
        XCTAssertEqual(try auth.secrets.get("auth_token"), "")
        XCTAssertEqual(try auth.secrets.get("pending_login"), "")
    }

    @MainActor
    func testAPIRoutingKeepsDevelopmentAndProductionCredentialsSeparate() async throws {
        let production = URL(string: "https://acode.app")!
        let development = URL(string: "https://dev.acode.app")!
        let previous = (HTTPCookieStorage.shared.cookies ?? []).filter { $0.name == "token" && AppAuthentication.hosts.contains($0.domain.trimmingCharacters(in: CharacterSet(charactersIn: "."))) }
        let unrelated = HTTPCookie(properties: [.name: "review-fixture-" + UUID().uuidString, .value: "other", .domain: "acode.app", .path: "/"])!
        HTTPCookieStorage.shared.setCookie(unrelated)
        defer {
            HTTPCookieStorage.shared.deleteCookie(unrelated)
            for cookie in HTTPCookieStorage.shared.cookies ?? [] where cookie.name == "token" && AppAuthentication.hosts.contains(cookie.domain.trimmingCharacters(in: CharacterSet(charactersIn: "."))) {
                HTTPCookieStorage.shared.deleteCookie(cookie)
            }
            previous.forEach(HTTPCookieStorage.shared.setCookie)
        }
        try auth.save("production-token")
        try auth.save("development-token", for: development)
        let dataStore = WKWebsiteDataStore.nonPersistent()
        try await auth.synchronizeCookies(dataStore.httpCookieStore)
        let webCookies = await dataStore.httpCookieStore.allCookies().filter { $0.name == "token" }
        XCTAssertEqual(Set(webCookies.map(\.domain)), Set(AppAuthentication.hosts))
        let api = AppAPIHandler(auth: auth)
        var source = URLRequest(url: URL(string: "acode://localhost/__api__/login?test=one%20two")!)
        source.setValue("include", forHTTPHeaderField: "X-Acode-Credentials")
        source.setValue("token=untrusted", forHTTPHeaderField: "Cookie")
        for (origin, token) in [(production, "production-token"), (development, "development-token")] {
            XCTAssertEqual((HTTPCookieStorage.shared.cookies(for: origin) ?? []).filter { $0.name == "token" }.map(\.value), [token])
            source.setValue(origin.absoluteString, forHTTPHeaderField: "X-Acode-API-Origin")
            let request = try api.request(for: source)
            XCTAssertEqual(request.url?.absoluteString, origin.absoluteString + "/api/login?test=one%20two")
            let tokens = (request.value(forHTTPHeaderField: "Cookie") ?? "").components(separatedBy: ";").map { $0.trimmingCharacters(in: .whitespaces) }.filter { $0.hasPrefix("token=") }
            XCTAssertEqual(tokens, ["token=" + token])
            XCTAssertFalse(request.httpShouldHandleCookies)
            XCTAssertNil(request.value(forHTTPHeaderField: "X-Acode-API-Origin"))
        }
        source.setValue("omit", forHTTPHeaderField: "X-Acode-Credentials")
        XCTAssertNil(try api.request(for: source).value(forHTTPHeaderField: "Cookie"))
        source.setValue("https://dev.acode.app.evil.test", forHTTPHeaderField: "X-Acode-API-Origin")
        XCTAssertThrowsError(try api.request(for: source))
        source.setValue(nil, forHTTPHeaderField: "X-Acode-API-Origin")
        XCTAssertEqual(try api.request(for: source).url?.host, production.host)
        try auth.logout()
        XCTAssertEqual(try auth.token(for: production), "")
        XCTAssertEqual(try auth.token(for: development), "")
    }

    func testExchangeErrorsExplainRetryTimingAndExpiredSignIn() {
        let url = URL(string: "https://dev.acode.app/api/user/app-token/exchange")!
        let limited = HTTPURLResponse(url: url, statusCode: 429, httpVersion: nil, headerFields: ["Retry-After": "61"])!
        XCTAssertEqual(AppAuthentication.exchangeFailure(limited).message, "Too many sign-in attempts. Please wait 2 minute(s) and try again.")
        let expired = HTTPURLResponse(url: url, statusCode: 400, httpVersion: nil, headerFields: nil)!
        XCTAssertEqual(AppAuthentication.exchangeFailure(expired).message, "Sign-in expired. Please try again.")
    }

    func testAPIResponseCookiesPersistUpdateAndExpireWithoutReplacingAccountTokens() throws {
        let name = "response-fixture-" + UUID().uuidString
        defer {
            for cookie in HTTPCookieStorage.shared.cookies ?? [] where cookie.name == name {
                HTTPCookieStorage.shared.deleteCookie(cookie)
            }
        }
        for host in AppAuthentication.hosts {
            let origin = URL(string: "https://" + host)!
            let url = origin.appendingPathComponent("api/cookie")
            try auth.save("account-token", for: origin)
            var source = URLRequest(url: URL(string: "acode://localhost/__api__/cookie")!)
            source.setValue(origin.absoluteString, forHTTPHeaderField: "X-Acode-API-Origin")
            source.setValue("include", forHTTPHeaderField: "X-Acode-Credentials")
            let api = AppAPIHandler(auth: auth)
            for (status, value) in [(200, "first"), (302, "updated")] {
                let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: ["Set-Cookie": "\(name)=\(value); Path=/api; Secure; HttpOnly, token=response-token; Path=/; Secure"])!
                let before = (HTTPCookieStorage.shared.cookies(for: url) ?? []).first { $0.name == name }?.value
                AppAPIHandler.storeCookies(from: response, credentials: false)
                XCTAssertEqual((HTTPCookieStorage.shared.cookies(for: url) ?? []).first { $0.name == name }?.value, before)
                AppAPIHandler.storeCookies(from: response, credentials: true)
                let cookie = (HTTPCookieStorage.shared.cookies(for: url) ?? []).first { $0.name == name }
                XCTAssertEqual(cookie?.value, value)
                XCTAssertEqual(cookie?.isHTTPOnly, true)
                XCTAssertFalse((HTTPCookieStorage.shared.cookies(for: url) ?? []).contains { $0.name == "token" && $0.value == "response-token" })
                let header = try api.request(for: source).value(forHTTPHeaderField: "Cookie") ?? ""
                XCTAssertTrue(header.contains("\(name)=\(value)"))
                XCTAssertTrue(header.contains("token=account-token"))
            }
            for expiry in ["Max-Age=0", "Expires=Thu, 01 Jan 1970 00:00:00 GMT"] {
                let renewed = HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: ["Set-Cookie": "\(name)=renewed; Path=/api; Secure"])!
                AppAPIHandler.storeCookies(from: renewed, credentials: true)
                let expired = HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: ["Set-Cookie": "\(name)=; Path=/api; \(expiry); Secure"])!
                AppAPIHandler.storeCookies(from: expired, credentials: false)
                XCTAssertEqual((HTTPCookieStorage.shared.cookies(for: url) ?? []).first { $0.name == name }?.value, "renewed")
                AppAPIHandler.storeCookies(from: expired, credentials: true)
                XCTAssertFalse((HTTPCookieStorage.shared.cookies(for: url) ?? []).contains { $0.name == name })
            }
            XCTAssertEqual(try auth.token(for: origin), "account-token")
        }
        let foreign = URL(string: "https://untrusted.example/api/cookie")!
        let response = HTTPURLResponse(url: foreign, statusCode: 200, httpVersion: nil, headerFields: ["Set-Cookie": "\(name)=foreign; Path=/"])!
        AppAPIHandler.storeCookies(from: response, credentials: true)
        XCTAssertFalse((HTTPCookieStorage.shared.cookies ?? []).contains { $0.name == name })
    }
}

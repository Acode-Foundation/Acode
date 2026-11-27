import CryptoKit
import Foundation
import WebKit

struct AppAuthentication {
    static let origin = "https://acode.app"
    static let hosts = ["acode.app", "dev.acode.app"]
    let secrets: SecretStore

    init(namespace: String = "acode_auth_secure") { secrets = SecretStore(namespace: namespace) }

    static func accepts(_ url: URL) -> Bool {
        url.scheme == "https" && hosts.contains(url.host ?? "") && (url.port == nil || url.port == 443) && url.user == nil && url.password == nil
    }

    func begin(baseURL: String, version: Int) throws -> URL {
        let base = try Self.baseURL(baseURL)
        let state = try SecureToken.generate(bytes: 24)
        let verifier = try SecureToken.generate()
        let challenge = SHA256.hash(data: Data(verifier.utf8)).map { String(format: "%02x", $0) }.joined()
        let pending = try JSONSerialization.data(withJSONObject: ["state": state, "verifier": verifier, "origin": base.absoluteString])
        try secrets.set("pending_login", value: String(decoding: pending, as: UTF8.self))
        var url = URLComponents(url: base.appendingPathComponent("login"), resolvingAgainstBaseURL: false)!
        url.queryItems = ["redirect": "app", "authFlow": "app-code", "state": state, "challenge": challenge, "appVersionCode": String(version), "src": "ios"].map { URLQueryItem(name: $0.key, value: $0.value) }
        return url.url!
    }

    func consume(_ url: URL) throws -> URLRequest {
        guard url.scheme == "acode", url.host == "auth", url.path == "/callback", url.user == nil, url.port == nil,
              let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems,
              items.filter({ $0.name == "code" }).count == 1, items.filter({ $0.name == "state" }).count == 1,
              let code = items.first(where: { $0.name == "code" })?.value, !code.isEmpty,
              let state = items.first(where: { $0.name == "state" })?.value, !state.isEmpty,
              let pending = try JSONSerialization.jsonObject(with: Data(secrets.get("pending_login").utf8)) as? [String: String],
              SecureToken.matches(state, pending["state"]), let verifier = pending["verifier"], !verifier.isEmpty else {
            throw SecretFailure("Invalid sign-in callback")
        }
        let base = try Self.baseURL(pending["origin"] ?? Self.origin)
        try cancel()
        var request = URLRequest(url: base.appendingPathComponent("api/user/app-token/exchange"))
        request.httpMethod = "POST"
        request.httpShouldHandleCookies = false
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["code": code, "state": state, "verifier": verifier])
        return request
    }

    func token(for url: URL) throws -> String { try secrets.get(Self.tokenKey(for: url)) }

    static func accountURL(baseURL: String) throws -> URL {
        let base = try Self.baseURL(baseURL)
        var url = URLComponents(url: base.appendingPathComponent("profile/edit"), resolvingAgainstBaseURL: false)!
        url.queryItems = [URLQueryItem(name: "src", value: "ios")]
        return url.url!
    }

    func save(_ token: String, for url: URL = URL(string: Self.origin)!) throws {
        guard !token.isEmpty, token.utf8.allSatisfy({ $0 == 0x21 || (0x23...0x2b).contains($0) || (0x2d...0x3a).contains($0) || (0x3c...0x5b).contains($0) || (0x5d...0x7e).contains($0) }) else {
            throw SecretFailure("Invalid sign-in token")
        }
        try secrets.set(Self.tokenKey(for: url), value: token)
    }

    func cancel() throws { try secrets.remove("pending_login") }
    func logout() throws { try cancel(); try secrets.remove("auth_token"); try secrets.remove("auth_token_dev") }

    @MainActor
    func synchronizeCookies(_ store: WKHTTPCookieStore) async throws {
        for cookie in HTTPCookieStorage.shared.cookies ?? [] where cookie.name == "token" && Self.hosts.contains(cookie.domain.trimmingCharacters(in: CharacterSet(charactersIn: "."))) {
            HTTPCookieStorage.shared.deleteCookie(cookie)
        }
        for cookie in await store.allCookies() where cookie.name == "token" && Self.hosts.contains(cookie.domain.trimmingCharacters(in: CharacterSet(charactersIn: "."))) {
            await store.deleteCookie(cookie)
        }
        for host in Self.hosts {
            let token = try token(for: URL(string: "https://" + host)!)
            if !token.isEmpty, let cookie = HTTPCookie(properties: [.name: "token", .value: token, .domain: host, .path: "/", .secure: "TRUE", .expires: Date.distantFuture, HTTPCookiePropertyKey("HttpOnly"): "TRUE", HTTPCookiePropertyKey("SameSite"): "None"]) {
                await store.setCookie(cookie)
                HTTPCookieStorage.shared.setCookie(cookie)
            }
        }
    }

    static func baseURL(_ value: String) throws -> URL {
        guard let url = URL(string: value), accepts(url), ["", "/"].contains(url.path), url.query == nil, url.fragment == nil else {
            throw SecretFailure("Unsupported sign-in URL")
        }
        return URL(string: "https://" + url.host!)!
    }

    static func exchangeFailure(_ response: HTTPURLResponse) -> SecretFailure {
        if response.statusCode == 429 {
            if let seconds = Int(response.value(forHTTPHeaderField: "Retry-After") ?? ""), seconds > 0 {
                let minutes = (min(seconds, 86400) + 59) / 60
                return SecretFailure("Too many sign-in attempts. Please wait \(minutes) minute(s) and try again.")
            }
            return SecretFailure("Too many sign-in attempts. Please wait before trying again.")
        }
        if [400, 401].contains(response.statusCode) { return SecretFailure("Sign-in expired. Please try again.") }
        return SecretFailure("The sign-in service is unavailable. Please try again later.")
    }

    private static func tokenKey(for url: URL) throws -> String {
        guard accepts(url) else { throw SecretFailure("Unsupported sign-in URL") }
        return url.host == "acode.app" ? "auth_token" : "auth_token_dev"
    }
}

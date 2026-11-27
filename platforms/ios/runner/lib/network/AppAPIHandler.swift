import WebKit

final class AppAPIHandler {
    private let origin: URL
    private let auth: AppAuthentication
    private var requests: [ObjectIdentifier: HTTPTransport] = [:]

    init(origin: URL = URL(string: AppAuthentication.origin)!, auth: AppAuthentication = AppAuthentication()) {
        self.origin = origin
        self.auth = auth
    }

    func start(_ task: WKURLSchemeTask) {
        let id = ObjectIdentifier(task)
        do {
            let request = try request(for: task.request)
            let source = task.request.url!
            let url = request.url!
            let credentials = task.request.value(forHTTPHeaderField: "X-Acode-Credentials") == "include"
            let redirects = task.request.value(forHTTPHeaderField: "X-Acode-Redirect") ?? "follow"
            let transport = HTTPTransport(request: request, followRedirects: redirects == "follow", connectTimeout: 30, readTimeout: 60, cookieStorage: .shared)
            transport.allowRedirect = { next in next.scheme == url.scheme && next.host == url.host && next.port == url.port && next.user == nil && next.password == nil }
            transport.onRedirect = { [auth] response, next in
                Self.storeCookies(from: response, credentials: credentials)
                try Self.applyCookies(to: &next, credentials: credentials, auth: auth)
            }
            transport.onResponse = { [weak self] response in
                Self.storeCookies(from: response, credentials: credentials)
                if redirects == "error", (300..<400).contains(response.statusCode) { throw URLError(.redirectToNonExistentLocation) }
                var headers: [String: String] = [:]
                for (key, value) in response.allHeaderFields {
                    let name = String(describing: key)
                    if !["set-cookie", "set-cookie2", "content-encoding", "content-length"].contains(name.lowercased()) { headers[name] = String(describing: value) }
                }
                headers["X-Acode-Response-URL"] = response.url?.absoluteString ?? url.absoluteString
                // URLSession delivers decompressed bytes, so the original encoding and size no longer apply.
                let result = HTTPURLResponse(url: source, statusCode: response.statusCode, httpVersion: "HTTP/1.1", headerFields: headers)!
                DispatchQueue.main.async { [weak self] in if self?.requests[id] != nil { task.didReceive(result) } }
            }
            transport.onData = { [weak self] data in DispatchQueue.main.async { [weak self] in if self?.requests[id] != nil { task.didReceive(data) } } }
            transport.onComplete = { [weak self] error in
                DispatchQueue.main.async { [weak self] in
                    guard self?.requests.removeValue(forKey: id) != nil else { return }
                    if let error { task.didFailWithError(error) }
                    else { task.didFinish() }
                }
            }
            requests[id] = transport
            transport.start()
        } catch { task.didFailWithError(error) }
    }

    func stop(_ task: WKURLSchemeTask) { requests.removeValue(forKey: ObjectIdentifier(task))?.cancel() }

    func request(for incomingRequest: URLRequest) throws -> URLRequest {
        guard let source = incomingRequest.url, source.scheme == "acode", source.host == "localhost", source.path.hasPrefix("/__api__/") else { throw URLError(.badURL) }
        let origin = try incomingRequest.value(forHTTPHeaderField: "X-Acode-API-Origin").map(AppAuthentication.baseURL) ?? self.origin
        var destination = URLComponents(url: origin, resolvingAgainstBaseURL: false)!
        let incoming = URLComponents(url: source, resolvingAgainstBaseURL: false)!
        destination.percentEncodedPath = "/api/" + incoming.percentEncodedPath.dropFirst("/__api__/".count)
        destination.percentEncodedQuery = incoming.percentEncodedQuery
        guard let url = destination.url else { throw URLError(.badURL) }
        var request = incomingRequest
        request.url = url
        request.mainDocumentURL = origin
        let credentials = request.value(forHTTPHeaderField: "X-Acode-Credentials") == "include"
        for key in (request.allHTTPHeaderFields ?? [:]).keys where ["host", "origin", "referer", "cookie", "content-length"].contains(key.lowercased()) || key.lowercased().hasPrefix("x-acode-") || key.lowercased().hasPrefix("sec-") {
            request.setValue(nil, forHTTPHeaderField: key)
        }
        request.setValue("https://localhost", forHTTPHeaderField: "Origin")
        request.setValue("https://localhost/", forHTTPHeaderField: "Referer")
        try Self.applyCookies(to: &request, credentials: credentials, auth: auth)
        return request
    }

    static func storeCookies(from response: HTTPURLResponse, credentials: Bool) {
        guard credentials, let url = response.url, AppAuthentication.accepts(url),
              let header = response.value(forHTTPHeaderField: "Set-Cookie") else { return }
        let storage = HTTPCookieStorage.shared
        guard storage.cookieAcceptPolicy != .never else { return }
        for cookie in HTTPCookie.cookies(withResponseHeaderFields: ["Set-Cookie": header], for: url) where cookie.name != "token" {
            let domain = cookie.domain.trimmingCharacters(in: CharacterSet(charactersIn: "."))
            guard AppAuthentication.hosts.contains(domain), url.host == domain || url.host!.hasSuffix("." + domain) else { continue }
            // Foundation requires the stored HttpOnly object when replacing or deleting it.
            for existing in storage.cookies ?? [] where existing.name == cookie.name && existing.domain == cookie.domain && existing.path == cookie.path {
                storage.deleteCookie(existing)
            }
            if let expiry = cookie.expiresDate, expiry <= Date() { continue }
            storage.setCookies([cookie], for: url, mainDocumentURL: url)
        }
    }

    private static func applyCookies(to request: inout URLRequest, credentials: Bool, auth: AppAuthentication) throws {
        guard let url = request.url else { throw URLError(.badURL) }
        let trusted = AppAuthentication.accepts(url)
        request.httpShouldHandleCookies = credentials && !trusted
        request.setValue(nil, forHTTPHeaderField: "Cookie")
        if credentials, trusted {
            // A parent-domain cookie must not override the token for the selected environment.
            var cookies = (HTTPCookieStorage.shared.cookies(for: url) ?? []).filter { $0.name != "token" }
            let token = try auth.token(for: url)
            if !token.isEmpty, let cookie = HTTPCookie(properties: [.name: "token", .value: token, .domain: url.host!, .path: "/", .secure: "TRUE"]) { cookies.append(cookie) }
            request.setValue(HTTPCookie.requestHeaderFields(with: cookies)["Cookie"], forHTTPHeaderField: "Cookie")
        }
    }
}

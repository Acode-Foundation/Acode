import AuthenticationServices
import WebKit

final class AuthenticatorService: BaseService {
    private var coordinator: SignInCoordinator!

    required init(bridge: Bridge) {
        super.init(bridge: bridge)
        DispatchQueue.main.async { [self] in
            self.coordinator = SignInCoordinator(bridge: bridge)
            IncomingLinks.shared.authenticationHandler = { [weak self] in self?.coordinator.receive($0) }
        }
    }

    override func exec(action: String, args: [Any], callback: Callback) {
        DispatchQueue.main.async { self.coordinator.exec(action: action, args: args, callback: callback) }
    }

    override func reset() { DispatchQueue.main.async { self.coordinator?.cancel() } }
}

@MainActor
private final class SignInCoordinator: NSObject, ASWebAuthenticationPresentationContextProviding {
    private weak var bridge: Bridge?
    private let auth = AppAuthentication()
    private var session: ASWebAuthenticationSession?
    private var exchange: HTTPTransport?
    private var callback: Callback?
    private var operation = UUID()

    init(bridge: Bridge) {
        self.bridge = bridge
        super.init()
        Task { try? await auth.synchronizeCookies(bridge.webView!.configuration.websiteDataStore.httpCookieStore) }
    }

    func exec(action: String, args: [Any], callback: Callback) {
        switch action {
        case "login", "openAccount":
            cancel()
            do {
                let options = args[safe: 0] as? [String: Any] ?? [:]
                let account = action == "openAccount"
                let baseURL = options["baseUrl"] as? String ?? AppAuthentication.origin
                let url = try account ? AppAuthentication.accountURL(baseURL: baseURL) : auth.begin(baseURL: baseURL, version: options["appVersionCode"] as? Int ?? 0)
                self.callback = callback
                let id = operation
                let session = ASWebAuthenticationSession(url: url, callbackURLScheme: "acode") { [weak self] url, error in
                    Task { @MainActor in
                        guard let self, self.operation == id else { return }
                        if account {
                            if let error, (error as? ASWebAuthenticationSessionError)?.code != .canceledLogin {
                                self.fail(error.localizedDescription); return
                            }
                            self.callback = nil; self.session = nil
                            callback.success()
                        }
                        else if let url { self.receive(url) }
                        else if (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin {
                            self.fail("Sign-in was cancelled. You can try again.")
                        }
                        else { self.fail(error?.localizedDescription ?? "Sign-in cancelled") }
                    }
                }
                session.presentationContextProvider = self
                self.session = session
                if !session.start() { fail(account ? "Unable to open account settings" : "Unable to open sign-in") }
            } catch { self.callback = nil; callback.error(error.localizedDescription) }
        case "saveToken", "logout":
            cancel()
            Task {
                do {
                    if action == "logout" { try auth.logout() }
                    else { try auth.save(args[safe: 0] as? String ?? "") }
                    if let store = bridge?.webView?.configuration.websiteDataStore.httpCookieStore { try await auth.synchronizeCookies(store) }
                    callback.success()
                } catch { callback.error(error.localizedDescription) }
            }
        default: callback.error("Unsupported Authenticator action: \(action)")
        }
    }

    func receive(_ url: URL) {
        guard exchange == nil else { return }
        do {
            let request = try auth.consume(url)
            let id = operation
            let transport = HTTPTransport(request: request, followRedirects: false, connectTimeout: 15, readTimeout: 30)
            var data = Data()
            transport.onResponse = { response in
                guard (200..<300).contains(response.statusCode) else { throw AppAuthentication.exchangeFailure(response) }
            }
            transport.onData = { bytes in
                guard data.count + bytes.count <= 65536 else { throw SecretFailure("Invalid sign-in response") }
                data.append(bytes)
            }
            transport.onComplete = { [weak self] error in
                Task { @MainActor in
                    guard let self, self.operation == id else { return }
                    do {
                        if let error { throw error }
                        let response = try JSONSerialization.jsonObject(with: data) as? [String: Any]
                        try self.auth.save(response?["token"] as? String ?? "", for: request.url!)
                        if let store = self.bridge?.webView?.configuration.websiteDataStore.httpCookieStore { try await self.auth.synchronizeCookies(store) }
                        guard self.operation == id else { return }
                        let callback = self.callback
                        self.callback = nil; self.exchange = nil; self.session = nil
                        callback?.success()
                    } catch {
                        self.fail((error as? SecretFailure)?.message ?? "Sign-in could not be completed. Please check your connection and try again.")
                    }
                }
            }
            exchange = transport
            transport.start()
        } catch { fail("Invalid sign-in callback") }
    }

    func cancel() {
        operation = UUID()
        session?.cancel(); session = nil
        exchange?.cancel(); exchange = nil
        callback?.error("Sign-in cancelled"); callback = nil
        try? auth.cancel()
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        bridge?.viewController?.view.window ?? ASPresentationAnchor()
    }

    private func fail(_ message: String) {
        callback?.error(message); callback = nil
        cancel()
    }
}

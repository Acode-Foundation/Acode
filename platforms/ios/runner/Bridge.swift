import WebKit

final class Bridge: NSObject, WKScriptMessageHandler {
    private(set) weak var webView: WKWebView?
    private(set) weak var viewController: WebViewController?
    private var services: [String: ServiceProtocol] = [:]
    private var serviceQueues: [String: DispatchQueue] = [:]
    private var navigationID = UUID()
    private(set) lazy var shareService = ShareService(bridge: self)

    func setup(webView: WKWebView, viewController: WebViewController) {
        if !services.isEmpty { reset() }
        _ = shareService
        self.webView = webView
        self.viewController = viewController
        services = [
            "Native":          NativeService(bridge: self),
            "FileHandler":     FileHandlerService(bridge: self),
            "Device":          DeviceService(bridge: self),
            "Dialog":          DialogService(bridge: self),
            "Encryption":      EncryptionService(bridge: self),
            "Notification":    NotificationService(bridge: self),
            "Scanner":         ScannerService(bridge: self),
            "EmbeddedProxy":   EmbeddedProxyService(bridge: self),
            "File":            FileService(bridge: self),
            "BuildInfo":       BuildInfoService(bridge: self),
            "Clipboard":       ClipboardService(bridge: self),
            "App":             AppService(bridge: self),
            "SystemBarPlugin": SystemBarService(bridge: self),
            "System":          SystemService(bridge: self),
            "SDcard":          DocumentsService(bridge: self),
            "NativeHttpPlugin": NativeHTTPService(bridge: self),
            "WebSocketPlugin": WebSocketService(bridge: self),
            "Tee":             PluginContextService(bridge: self),
            "Authenticator":   AuthenticatorService(bridge: self),
            "CustomTabs":      SafariService(bridge: self),
            "Server":          ServerService(bridge: self),
            "Browser":         BrowserService(bridge: self),
            "AcodeWebView":    PluginWebViewService(bridge: self),
            "Sftp":            SFTPService(bridge: self),
            "Ftp":             FTPService(bridge: self),
            "Iap":             IapService(bridge: self),
            "Alpine":          AlpineService(bridge: self),
            "Executor":        ExecutorService(bridge: self),
            "BackgroundExecutor": BackgroundExecutorService(bridge: self),
            "AdMob":           AMBPlugin(bridge: self),
        ]
        serviceQueues = services.mapValues { _ in DispatchQueue(label: "app.acode.service." + UUID().uuidString, qos: .userInitiated) }
    }

    var adsService: AMBPlugin? { services["AdMob"] as? AMBPlugin }

    // Called on the main thread by WKWebView.
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "exec",
              let body = message.body as? [String: Any],
              let service = body["service"] as? String,
              let action = body["action"] as? String,
              let argsString = body["args"] as? String,
              let id = body["id"] as? Int else { return }

        let currentNavigation = navigationID
        let callback = Callback(id: id, webView: webView, isValid: { [weak self] in self?.navigationID == currentNavigation })
        guard message.frameInfo.isMainFrame,
              let source = message.frameInfo.request.url,
              source.scheme == "acode", source.host == "localhost" else {
            callback.error("Native services are only available to the app"); return
        }
        guard let svc = services[service] else {
            callback.error(["code": "UNSUPPORTED_SERVICE", "message": "\(service) is unavailable on iOS"]); return
        }

        let args: [Any]
        if let data = argsString.data(using: .utf8),
           let arr = try? JSONSerialization.jsonObject(with: data) as? [Any] {
            args = arr
        } else {
            args = []
        }

        serviceQueues[service]?.async {
            svc.exec(action: action, args: args, callback: callback)
        }
    }

    func reset() {
        navigationID = UUID()
        shareService.reset()
        for (name, service) in services { serviceQueues[name]?.async { service.reset() } }
    }
}

import UIKit
import WebKit
import GameController

final class WebViewController: UIViewController {
    private(set) var webView: WKWebView!
    let bridge = Bridge()
    private(set) var isKeyboardVisible = false
    private(set) var keyboardHeight: CGFloat = 0
    private(set) var fullscreen: WebFullscreen!
    private var contentTop: NSLayoutConstraint!
    private var contentBottom: NSLayoutConstraint!
    private var normalLayout: [NSLayoutConstraint] = []
    private var fullscreenLayout: [NSLayoutConstraint] = []
    var isFullscreenLayout: Bool { fullscreenLayout.first?.isActive == true }
    private var scrollObservation: NSKeyValueObservation?
    private var contextMenu: WebContextMenu?

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(named: "SplashBackground")

        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(AppURLSchemeHandler(), forURLScheme: "acode")

        let contentController = WKUserContentController()
        #if DEBUG && targetEnvironment(simulator)
        if ProcessInfo.processInfo.arguments.contains("-acode-ui-testing") {
            SimulatorTestSupport.disableConsent(in: contentController)
        }
        #endif
        WebShadowCaret.install(on: contentController)
        contentController.add(WeakScriptMessageHandler(bridge), name: "exec")
        config.userContentController = contentController
        config.preferences.javaScriptCanOpenWindowsAutomatically = true
        config.preferences.isElementFullscreenEnabled = true

        config.allowsInlineMediaPlayback = true
        webView = AppWebView(frame: .zero, configuration: config)
        contextMenu = WebContextMenu(webView: webView)
        webView.navigationDelegate = self
        #if DEBUG
        webView.isInspectable = true
        #endif
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.isScrollEnabled = false
        webView.backgroundColor = view.backgroundColor
        webView.isOpaque = false

        let content = UIView()
        view.addSubview(content)
        content.addSubview(webView)
        content.translatesAutoresizingMaskIntoConstraints = false
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        contentTop = content.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor)
        contentBottom = content.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor)
        normalLayout = [
            contentTop,
            content.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor),
            content.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor),
            contentBottom,
        ]
        fullscreenLayout = [
            content.topAnchor.constraint(equalTo: view.topAnchor),
            content.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            content.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            content.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ]
        NSLayoutConstraint.activate(normalLayout)

        // The keyboard layout guide resizes the editor; WebKit scrolling would shift it twice.
        scrollObservation = webView.scrollView.observe(\.contentOffset, options: [.new]) { scrollView, _ in
            if scrollView.contentOffset != .zero {
                scrollView.contentOffset = .zero
            }
        }

        fullscreen = WebFullscreen(controller: self)
        bridge.setup(webView: webView, viewController: self)
        webView.load(URLRequest(url: URL(string: "acode://localhost/")!))
        observeKeyboard()

        NotificationCenter.default.addObserver(self, selector: #selector(appMovedToBackground), name: UIApplication.didEnterBackgroundNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(appCameToForeground), name: UIApplication.willEnterForegroundNotification, object: nil)
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        bridge.adsService?.banners.layout()
    }

    func setContentInsets(top: CGFloat, bottom: CGFloat) {
        guard contentTop.constant != top || contentBottom.constant != -bottom else { return }
        contentTop.constant = top
        contentBottom.constant = -bottom
        view.layoutIfNeeded()
    }

    func setFullscreenLayout(_ active: Bool) {
        NSLayoutConstraint.deactivate(active ? normalLayout : fullscreenLayout)
        NSLayoutConstraint.activate(active ? fullscreenLayout : normalLayout)
        setThemeType(themeType)
        setNeedsUpdateOfHomeIndicatorAutoHidden()
        setNeedsUpdateOfScreenEdgesDeferringSystemGestures()
        view.layoutIfNeeded()
        bridge.adsService?.banners.layout()
    }

    @objc func appMovedToBackground() {
        let script = "document.dispatchEvent(new CustomEvent('pause'));"
        webView.evaluateJavaScript(script, completionHandler: nil)
    }

    @objc func appCameToForeground() {
        let script = "document.dispatchEvent(new CustomEvent('resume'));"
        webView.evaluateJavaScript(script, completionHandler: nil)
    }

    private func observeKeyboard() {
        NotificationCenter.default.addObserver(
            self, selector: #selector(keyboardWillShow),
            name: UIResponder.keyboardWillChangeFrameNotification, object: nil
        )
        NotificationCenter.default.addObserver(
            self, selector: #selector(keyboardWillHide),
            name: UIResponder.keyboardWillHideNotification, object: nil
        )
    }

    @objc private func keyboardWillShow(_ notification: Notification) {
        guard let info = notification.userInfo,
              let frame = info[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect else { return }
        let localFrame = view.convert(frame, from: nil)
        keyboardHeight = max(0, view.bounds.intersection(localFrame).height - view.safeAreaInsets.bottom)
        isKeyboardVisible = keyboardHeight > 0
        webView.evaluateJavaScript("window.dispatchEvent(new CustomEvent('keyboardshow', { detail: { height: \(keyboardHeight) } }))", completionHandler: nil)
    }

    @objc private func keyboardWillHide(_ notification: Notification) {
        isKeyboardVisible = false
        keyboardHeight = 0
        webView.evaluateJavaScript("window.dispatchEvent(new CustomEvent('keyboardhide'))", completionHandler: nil)
    }

    private(set) var themeType: String = "dark"

    override var preferredStatusBarStyle: UIStatusBarStyle {
        themeType == "light" ? .darkContent : .lightContent
    }

    var statusBarHidden = false
    override var prefersStatusBarHidden: Bool { statusBarHidden || isFullscreenLayout }
    override var prefersHomeIndicatorAutoHidden: Bool { isFullscreenLayout }
    override var preferredScreenEdgesDeferringSystemGestures: UIRectEdge { isFullscreenLayout ? .all : [] }

    var systemConfiguration: [String: Any] {
        let hardwareKeyboard = GCKeyboard.coalesced != nil
        return ["hardKeyboardHidden": hardwareKeyboard ? 1 : 2, "keyboardHidden": isKeyboardVisible ? 1 : 2,
                "keyboardHeight": keyboardHeight, "keyboard": hardwareKeyboard ? 2 : 1,
                "orientation": view.bounds.width > view.bounds.height ? 2 : 1,
                "navigation": 0, "navigationHidden": 2, "touchscreen": 3,
                "locale": Locale.current.identifier.replacingOccurrences(of: "_", with: "-"),
                "fontScale": UIFontMetrics.default.scaledValue(for: 17) / 17]
    }

    func setThemeType(_ type: String) {
        themeType = type
        fullscreen?.updateControls()
        setNeedsStatusBarAppearanceUpdate()
        var vc: UIViewController? = parent
        while let current = vc {
            current.setNeedsStatusBarAppearanceUpdate()
            vc = current.parent
        }
    }

    func setSystemBarColor(_ color: UIColor) {
        view.backgroundColor = color
        webView.backgroundColor = color
        view.window?.backgroundColor = color
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }
}

extension WebViewController: WKNavigationDelegate {
    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        bridge.reset()
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
        guard let url = navigationAction.request.url else { return .cancel }
        if url.scheme == "acode" { return .allow }
        #if DEBUG
        if url.scheme == "http" || url.scheme == "https" { return .allow }
        #endif
        return .cancel
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        print("[WebView] didFailProvisionalNavigation: \(error)")
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        print("[WebView] didFail: \(error)")
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        print("[WebView] didFinish loading: \(webView.url?.absoluteString ?? "nil")")
    }
}

// Prevents WKUserContentController from retaining the message handler (avoids memory leak).
final class WeakScriptMessageHandler: NSObject, WKScriptMessageHandler {
    private weak var delegate: WKScriptMessageHandler?
    init(_ delegate: WKScriptMessageHandler) { self.delegate = delegate }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        delegate?.userContentController(controller, didReceive: message)
    }
}

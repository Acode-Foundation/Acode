import UIKit
import WebKit

@MainActor
final class PreviewViewController: UIViewController {
    let webView: WKWebView
    let initialURL: URL
    let consoleOnly: Bool
    let theme: [String: Any]
    let address = UITextField()
    let content = UIView()
    let toolbar = UIStackView()
    let progress = UIActivityIndicatorView(style: .medium)
    let menuButton = UIButton(type: .system)
    var consoleVisible = false
    var consoleAvailable = false
    var disableCache = false
    var showTools = true
    var allowsDownloads = true
    var externalSchemesAllowed = true
    var navigationPolicy: ((WKNavigationAction) -> Bool)?
    var onPageFinished: (() -> Void)?
    var onTitleChanged: ((String) -> Void)?
    var consoleEnabled = true
    var viewport: CGSize?
    var viewportScale: CGFloat = 1
    var onExternal: ((URL) -> Void)?
    var onClose: (() -> Void)?
    var pendingDialog: (() -> Void)?
    weak var auxiliaryPresenter: UIViewController?
    weak var activeDialog: UIAlertController?
    private(set) var isClosed = false
    private var observations: [NSKeyValueObservation] = []
    private var contextMenu: WebContextMenu?
    private var contentBottom: NSLayoutConstraint?
    private var contentFollowsKeyboard = true

    init(url: URL, theme: [String: Any], console: Bool) {
        initialURL = url
        self.theme = theme
        consoleOnly = console
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = WKWebsiteDataStore(forIdentifier: UUID(uuidString: "A0C0DE00-0000-4000-8000-000000000001")!)
        configuration.allowsInlineMediaPlayback = true
        configuration.preferences.isElementFullscreenEnabled = true
        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init(nibName: nil, bundle: nil)
        contextMenu = WebContextMenu(webView: webView)
        modalPresentationStyle = .fullScreen
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func viewDidLoad() {
        super.viewDidLoad()
        let background = (theme["primaryColor"] as? String).flatMap(UIColor.init(hexString:)) ?? .systemBackground
        let foreground = (theme["primaryTextColor"] as? String).flatMap(UIColor.init(hexString:)) ?? .label
        view.backgroundColor = background
        if theme["type"] as? String == "dark" { overrideUserInterfaceStyle = .dark }
        if theme["type"] as? String == "light" { overrideUserInterfaceStyle = .light }
        view.tintColor = foreground
        content.clipsToBounds = true
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        #if DEBUG
        webView.isInspectable = true
        #endif
        configureToolbar(foreground: foreground)
        for child in [toolbar, content] { child.translatesAutoresizingMaskIntoConstraints = false; view.addSubview(child) }
        content.addSubview(webView)
        contentBottom = content.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor)
        contentBottom?.isActive = true
        NSLayoutConstraint.activate([
            toolbar.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            toolbar.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor),
            toolbar.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor), toolbar.heightAnchor.constraint(equalToConstant: 45),
            content.topAnchor.constraint(equalTo: toolbar.bottomAnchor), content.leadingAnchor.constraint(equalTo: toolbar.leadingAnchor),
            content.trailingAnchor.constraint(equalTo: toolbar.trailingAnchor),
        ])
        NotificationCenter.default.addObserver(self, selector: #selector(keyboardFrameChanged), name: UIResponder.keyboardWillChangeFrameNotification, object: nil)
        observations = [
            webView.observe(\.canGoBack, options: [.new]) { [weak self] _, _ in MainActor.assumeIsolated { self?.updateMenu() } },
            webView.observe(\.canGoForward, options: [.new]) { [weak self] _, _ in MainActor.assumeIsolated { self?.updateMenu() } },
            webView.observe(\.title, options: [.new]) { [weak self] view, _ in
                MainActor.assumeIsolated { self?.updateAddress(); self?.onTitleChanged?(view.title ?? "") }
            },
            webView.observe(\.fullscreenState, options: [.new]) { [weak self] view, _ in
                MainActor.assumeIsolated { if view.fullscreenState == .notInFullscreen { self?.view.setNeedsLayout() } }
            },
        ]
        updateMenu()
        load(initialURL)
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        guard webView.superview === content else { return }
        let size = viewport ?? content.bounds.size
        let scale = viewport == nil ? 1 : min(content.bounds.width / max(size.width, 1), content.bounds.height / max(size.height, 1)) * viewportScale
        webView.transform = .identity
        webView.bounds = CGRect(origin: .zero, size: size)
        webView.center = CGPoint(x: content.bounds.midX, y: content.bounds.midY)
        webView.transform = CGAffineTransform(scaleX: scale, y: scale)
    }

    func load(_ url: URL) {
        guard ["http", "https"].contains(url.scheme?.lowercased() ?? "") else { return }
        prepareNavigation { [weak self] in
            guard let self else { return }
            self.webView.load(URLRequest(url: url, cachePolicy: self.disableCache ? .reloadIgnoringLocalCacheData : .useProtocolCachePolicy))
        }
    }

    func prepareNavigation(_ action: @escaping @MainActor @Sendable () -> Void) {
        guard !isClosed else { return }
        if disableCache {
            webView.configuration.websiteDataStore.removeData(ofTypes: [WKWebsiteDataTypeDiskCache, WKWebsiteDataTypeMemoryCache, WKWebsiteDataTypeFetchCache], modifiedSince: .distantPast) { [weak self] in
                guard let self, !self.isClosed else { return }
                action()
            }
        } else { action() }
    }

    var dialogPresenter: UIViewController? { isClosed ? nil : (isViewLoaded && view.window != nil ? self : auxiliaryPresenter) }

    @objc private func keyboardFrameChanged(_ notification: Notification) {
        guard !isClosed, let window = viewIfLoaded?.window,
              let frame = notification.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect else { return }
        // iOS 26 can leave the keyboard guide above the safe area after dismissal.
        let visible = view.bounds.intersection(view.convert(frame, from: window.screen.coordinateSpace)).height > 0
        guard visible != contentFollowsKeyboard else { return }
        contentFollowsKeyboard = visible
        let anchor = visible ? view.keyboardLayoutGuide.topAnchor : view.safeAreaLayoutGuide.bottomAnchor
        contentBottom?.isActive = false
        contentBottom = content.bottomAnchor.constraint(equalTo: anchor)
        contentBottom?.isActive = true
        let duration = notification.userInfo?[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double ?? 0
        let curve = notification.userInfo?[UIResponder.keyboardAnimationCurveUserInfoKey] as? UInt ?? 0
        UIView.animate(withDuration: duration, delay: 0, options: UIView.AnimationOptions(rawValue: curve << 16)) {
            self.view.layoutIfNeeded()
        }
    }

    @objc func close() {
        isClosed = true
        pendingDialog?(); pendingDialog = nil
        let dialog = activeDialog; activeDialog = nil
        webView.stopLoading()
        let completion = onClose; onClose = nil
        if let presenter = presentingViewController { presenter.dismiss(animated: true) { completion?() } }
        else if let dialog, dialog.presentingViewController != nil { dialog.dismiss(animated: false) { completion?() } }
        else { completion?() }
    }
}

import GoogleMobileAds
import UIKit
import WebKit

final class AdsIntegrationViewController: UIViewController {
    private let url: URL

    init(url: URL) {
        self.url = url
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { nil }

    override func viewDidLoad() {
        super.viewDidLoad()
        let webView = WKWebView(frame: view.bounds)
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(webView)
        MobileAds.shared.register(webView)
        webView.load(URLRequest(url: url))
    }
}

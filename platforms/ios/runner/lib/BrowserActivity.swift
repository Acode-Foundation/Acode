import UIKit

final class BrowserActivity: UIActivity {
    let url: URL
    private let name: String
    private let identifier: String

    init(name: String, identifier: String, url: URL) {
        self.name = name
        self.identifier = identifier
        self.url = url
        super.init()
    }

    override class var activityCategory: UIActivity.Category { .action }
    override var activityType: UIActivity.ActivityType? { UIActivity.ActivityType("app.acode.browser.\(identifier)") }
    override var activityTitle: String? { "Open in \(name)" }
    override var activityImage: UIImage? { UIImage(systemName: "globe") }

    override func canPerform(withActivityItems activityItems: [Any]) -> Bool { true }

    override func perform() {
        UIApplication.shared.open(url) { opened in self.activityDidFinish(opened) }
    }

    static func available(for url: URL, canOpen: (URL) -> Bool) -> [BrowserActivity] {
        guard let scheme = url.scheme?.lowercased(), ["http", "https"].contains(scheme), url.host != nil else { return [] }
        var activities = [BrowserActivity(name: "Default Browser", identifier: "default", url: url)]
        var chrome = URLComponents(url: url, resolvingAgainstBaseURL: false)
        chrome?.scheme = scheme == "https" ? "googlechromes" : "googlechrome"
        if let target = chrome?.url, canOpen(target) {
            activities.append(BrowserActivity(name: "Chrome", identifier: "chrome", url: target))
        }
        var firefox = URLComponents()
        firefox.scheme = "firefox"
        firefox.host = "open-url"
        firefox.queryItems = [URLQueryItem(name: "url", value: url.absoluteString)]
        if let target = firefox.url, canOpen(target) {
            activities.append(BrowserActivity(name: "Firefox", identifier: "firefox", url: target))
        }
        return activities
    }
}

import UIKit
import WebKit

protocol ServiceProtocol: AnyObject {
    func exec(action: String, args: [Any], callback: Callback)
    func reset()
}

class BaseService: NSObject, ServiceProtocol {
    weak var bridge: Bridge?

    required init(bridge: Bridge) {
        self.bridge = bridge
    }

    var webView: WKWebView? { bridge?.webView }
    var viewController: WebViewController? { bridge?.viewController }

    func exec(action: String, args: [Any], callback: Callback) {
        callback.error("Action '\(action)' not implemented")
    }

    func reset() {}
}

// MARK: - Shared utilities

extension Array {
    subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}

extension UIColor {
    convenience init?(hexString: String) {
        let hex = hexString.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let a, r, g, b: UInt64
        switch hex.count {
        case 3:  (a, r, g, b) = (255, (int >> 8) * 17, (int >> 4 & 0xF) * 17, (int & 0xF) * 17)
        case 6:  (a, r, g, b) = (255, int >> 16, int >> 8 & 0xFF, int & 0xFF)
        case 8:  (a, r, g, b) = (int >> 24, int >> 16 & 0xFF, int >> 8 & 0xFF, int & 0xFF)
        default: return nil
        }
        self.init(
            red: Double(r) / 255,
            green: Double(g) / 255,
            blue: Double(b) / 255,
            alpha: Double(a) / 255
        )
    }
}

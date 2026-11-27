import GoogleMobileAds
import UIKit

final class AMBContext: AMBCoreContext {
    weak var plugin: AMBPlugin?
    let args: [Any]
    let opts: [String: Any]
    let callback: Callback
    let generation: UUID
    private var settled = false

    init(_ plugin: AMBPlugin, _ args: [Any], _ callback: Callback) {
        self.plugin = plugin
        self.args = args
        self.opts = args.first as? [String: Any] ?? [:]
        self.callback = callback
        generation = plugin.generation
    }

    var isCurrent: Bool { plugin?.generation == generation }
    func has(_ name: String) -> Bool { opts[name] != nil }
    func opt(_ name: String) -> Any? { opts[name] }
    func opt0() -> Any? { args.first }
    func optBool(_ name: String) -> Bool? { opt(name) as? Bool }
    func optFloat(_ name: String) -> Float? { (opt(name) as? NSNumber)?.floatValue }
    func optInt(_ name: String) -> Int? { opt(name) as? Int }
    func optString(_ name: String, _ fallback: String) -> String { opt(name) as? String ?? fallback }
    func optStringArray(_ name: String) -> [String]? { opt(name) as? [String] }

    func resolve() { finish(nil) }
    func resolve(_ value: Bool) { finish(value) }
    func resolve(_ value: UInt) { finish(value) }
    func resolve(_ value: [String: Any]) { finish(value) }

    func reject(_ message: String) {
        guard !settled else { return }
        settled = true
        if isCurrent { callback.error(message) }
    }

    private func finish(_ value: Any?) {
        guard !settled else { return }
        settled = true
        if isCurrent { callback.success(value) }
    }

    func optOffset() -> CGFloat? {
        return opt("offset") as? CGFloat
    }

    func optBackgroundColor() -> UIColor? {
        if let bgColor = opt("backgroundColor") as? NSDictionary,
           let r = bgColor["r"] as? CGFloat,
           let g = bgColor["g"] as? CGFloat,
           let b = bgColor["b"] as? CGFloat,
           let a = bgColor["a"] as? CGFloat {
            return UIColor(red: r / 255, green: g / 255, blue: b / 255, alpha: a / 255)
        }
        return nil
    }

    func optMarginTop() -> CGFloat? {
        return opt("marginTop") as? CGFloat
    }

    func optMarginBottom() -> CGFloat? {
        return opt("marginBottom") as? CGFloat
    }

    // swiftlint:disable cyclomatic_complexity
    func optAdSize() -> AdSize {
        if let adSizeType = opt("size") as? Int {
            switch adSizeType {
            case 0:
                return AdSizeBanner
            case 1:
                return AdSizeLargeBanner
            case 2:
                return AdSizeMediumRectangle
            case 3:
                return AdSizeFullBanner
            case 4:
                return AdSizeLeaderboard
            default: break
            }
        }
        if let adSizeDict = opt("size") as? NSDictionary {
            if let adaptive = adSizeDict["adaptive"] as? String {
                var width = plugin?.viewController?.view.safeAreaLayoutGuide.layoutFrame.width ?? 320
                if let w = adSizeDict["width"] as? CGFloat {
                    width = w
                }
                if adaptive == "inline",
                    let maxHeight = adSizeDict["maxHeight"] as? CGFloat {
                    return inlineAdaptiveBanner(width: width, maxHeight: maxHeight)
                } else {
                    // Keep the compact anchored size; the newer large helpers increase editor insets.
                    switch adSizeDict["orientation"] as? String {
                    case "portrait":
                        return portraitAnchoredAdaptiveBanner(width: width)
                    case "landscape":
                        return landscapeAnchoredAdaptiveBanner(width: width)
                    default:
                        return currentOrientationAnchoredAdaptiveBanner(width: width)
                    }
                }
            } else if let width = adSizeDict["width"] as? Int,
                 let height = adSizeDict["height"] as? Int {
                return adSizeFor(cgSize: CGSize(width: width, height: height))
            }
        }
        return AdSizeBanner
    }
    // swiftlint:enable cyclomatic_complexity

    func optGADServerSideVerificationOptions() -> ServerSideVerificationOptions? {
        guard let ssv = opt("serverSideVerification") as? NSDictionary
        else {
            return nil
        }

        let options = ServerSideVerificationOptions.init()
        if let customData = ssv.value(forKey: "customData") as? String {
            options.customRewardText = customData
        }
        if let userId = ssv.value(forKey: "userId") as? String {
            options.userIdentifier = userId
        }
        return options
    }

}

import UIKit
import WebKit

final class BuildInfoService: BaseService {
    override func exec(action: String, args: [Any], callback: Callback) {
        guard action == "init" else { callback.error("Unknown BuildInfo action: \(action)"); return }
        let info = Bundle.main.infoDictionary ?? [:]
        let id = Bundle.main.bundleIdentifier ?? "app.acode"
        let name = info["CFBundleDisplayName"] as? String ?? "Acode"
        #if DEBUG
        let debug = true
        let buildType = "debug"
        #else
        let debug = false
        let buildType = "release"
        #endif
        let flavor = "free"
        callback.success(["packageName": id, "basePackageName": id, "displayName": name, "name": name,
                          "version": info["CFBundleShortVersionString"] as? String ?? "", "versionCode": Int(info["CFBundleVersion"] as? String ?? "0") ?? 0,
                          "debug": debug, "buildType": buildType, "flavor": flavor])
    }
}

final class ClipboardService: BaseService {
    override func exec(action: String, args: [Any], callback: Callback) {
        DispatchQueue.main.async {
            switch action {
            case "copy": UIPasteboard.general.string = args[safe: 0] as? String ?? ""; callback.success()
            case "paste": callback.success(UIPasteboard.general.string ?? "")
            case "clear": UIPasteboard.general.items = []; callback.success()
            default: callback.error("Unknown Clipboard action: \(action)")
            }
        }
    }
}

final class AppService: BaseService {
    override func exec(action: String, args: [Any], callback: Callback) {
        DispatchQueue.main.async { [self] in
            switch action {
            case "backHistory": self.webView?.goBack(); callback.success()
            case "clearCache", "clear-cache":
                WKWebsiteDataStore.default().removeData(ofTypes: [WKWebsiteDataTypeDiskCache, WKWebsiteDataTypeMemoryCache], modifiedSince: .distantPast) {
                    callback.success(action == "clear-cache" ? "Cache cleared" : nil)
                }
            case "exitApp": exit(0)
            default: callback.error("\(action) is unavailable on iOS")
            }
        }
    }
}

final class SystemBarService: BaseService {
    override func exec(action: String, args: [Any], callback: Callback) {
        DispatchQueue.main.async { [weak self] in
            guard let controller = self?.viewController else { callback.error("View unavailable"); return }
            switch action {
            case "setStatusBarVisible":
                controller.statusBarHidden = !(args[safe: 0] as? Bool ?? true)
                controller.setNeedsStatusBarAppearanceUpdate()
            case "setStatusBarBackgroundColor":
                if args.count >= 3 {
                    let color = UIColor(red: (args[0] as? Double ?? 0) / 255, green: (args[1] as? Double ?? 0) / 255, blue: (args[2] as? Double ?? 0) / 255, alpha: args[safe: 3] as? Double ?? 1)
                    controller.setSystemBarColor(color)
                }
            default: callback.error("Unknown SystemBar action: \(action)"); return
            }
            callback.success()
        }
    }
}

import CryptoKit
import UIKit
import WebKit

final class SystemService: BaseService {
    private lazy var native = NativeService(bridge: bridge!)
    private let files = AppFiles.shared
    private let streams = HTTPStreamService()
    private let rewards = RewardPassManager()
    private lazy var browser = SafariService(bridge: bridge!)
    private lazy var preview = BrowserService(bridge: bridge!)

    override func reset() {
        streams.reset()
        browser.reset()
        preview.reset()
        DispatchQueue.main.async { [weak self] in
            IncomingLinks.shared.reset()
            self?.viewController?.fullscreen.setActive(false)
            (self?.webView as? AppWebView)?.nativeContextMenuDisabled = false
        }
    }

    override func exec(action: String, args: [Any], callback: Callback) {
        do {
            switch action {
            case "http-stream-start", "http-stream-cancel", "http-stream-ack": streams.exec(action: action, args: args, callback: callback)
            case "get-available-encodings": callback.success(FileContents.availableEncodings())
            case "encode":
                guard let text = args[safe: 0] as? String, let data = text.data(using: try FileContents.encoding(args[safe: 1] as? String ?? "UTF-8")) else { throw FileFailure(5) }
                callback.successBinary(data)
            case "decode":
                guard let encoded = args[safe: 0] as? String, let data = Data(base64Encoded: encoded), let text = String(data: data, encoding: try FileContents.encoding(args[safe: 1] as? String ?? "UTF-8")) else { throw FileFailure(5) }
                callback.success(text)
            case "getInstaller": callback.success("appstore")
            case "getRewardStatus": callback.success(try rewards.getRewardStatus())
            case "get-android-version": callback.success(0)
            case "get-configuration":
                DispatchQueue.main.async { [weak self] in callback.success(self?.viewController?.systemConfiguration ?? [:]) }
            case "get-app-info": native.exec(action: "getAppInfo", args: args, callback: callback)
            case "get-webkit-info": callback.success(["packageName": "com.apple.WebKit", "versionName": ProcessInfo.processInfo.operatingSystemVersionString])
            case "is-powersave-mode": callback.success(ProcessInfo.processInfo.isLowPowerModeEnabled)
            case "getFilesDir": callback.success(files.data.path)
            case "getArch":
                #if arch(arm64)
                callback.success("arm64-v8a")
                #else
                callback.success("x86_64")
                #endif
            case "shareText":
                guard let share = bridge?.shareService else { callback.error("Native bridge unavailable"); return }
                share.exec(action: action, args: args, callback: callback)
            case "file-action":
                let intent = args[safe: 2] as? String ?? "android.intent.action.VIEW"
                guard ["android.intent.action.VIEW", "android.intent.action.SEND"].contains(intent) else {
                    callback.error(["code": "UNSUPPORTED_ACTION", "message": "File intent \(intent) is unavailable on iOS"]); return
                }
                guard let share = bridge?.shareService else { callback.error("Native bridge unavailable"); return }
                share.exec(action: "shareFile", args: args, callback: callback)
            case "open-in-browser": browser.exec(action: "external", args: args, callback: callback)
            case "in-app-browser": preview.exec(action: action, args: args, callback: callback)
            case "set-ui-theme": native.exec(action: "setTheme", args: [args[safe: 0] ?? "", args[safe: 1] ?? [:]], callback: callback)
            case "set-app-icon": AppIconService.set(args[safe: 0] as? String ?? "default", callback: callback)
            case "has-permission", "request-permission":
                native.exec(action: action == "has-permission" ? "hasPermission" : "requestPermission", args: args, callback: callback)
            case "request-permissions": native.exec(action: "requestPermissions", args: args, callback: callback)
            case "isManageExternalStorageDeclared", "hasGrantedStorageManager", "is-external-storage-manager": callback.success(false)
            case "clearCache", "clear-cache": AppService(bridge: bridge!).exec(action: action, args: [], callback: callback)
            case "checksumText":
                guard let text = args[safe: 0] as? String else { throw FileFailure(5) }
                callback.success(SHA256.hash(data: Data(text.utf8)).map { String(format: "%02x", $0) }.joined())
            case "get-global-setting":
                DispatchQueue.main.async {
                    if args[safe: 0] as? String == "animator_duration_scale" { callback.success(UIAccessibility.isReduceMotionEnabled ? 0 : 1) }
                    else { callback.error("System setting is unavailable on iOS") }
                }
            case "get-intent": DispatchQueue.main.async { IncomingLinks.shared.current(callback) }
            case "set-intent-handler": DispatchQueue.main.async { IncomingLinks.shared.listen(callback) }
            case "set-fullscreen":
                DispatchQueue.main.async { [weak self] in
                    guard let fullscreen = self?.viewController?.fullscreen,
                          let active = args[safe: 0] as? Bool else { callback.error("Invalid fullscreen request"); return }
                    fullscreen.setActive(active, callback: callback)
                }
            case "set-fullscreen-orientation":
                DispatchQueue.main.async { [weak self] in
                    guard let fullscreen = self?.viewController?.fullscreen else { callback.error("View unavailable"); return }
                    fullscreen.setOrientation(args[safe: 0], callback: callback)
                }
            case "set-fullscreen-back-handler":
                DispatchQueue.main.async { [weak self] in
                    guard let fullscreen = self?.viewController?.fullscreen,
                          let enabled = args[safe: 0] as? Bool else { callback.error("Invalid Back handler request"); return }
                    fullscreen.setBackHandler(enabled, callback: callback)
                }
            case "set-native-context-menu-disabled":
                DispatchQueue.main.async { [weak self] in
                    (self?.webView as? AppWebView)?.nativeContextMenuDisabled = (args[safe: 0] as? String == "true")
                    callback.success()
                }
            case "compare-texts":
                let first = args[safe: 0] as? String ?? ""
                let second = args[safe: 1] as? String ?? ""
                callback.success(first.utf16.elementsEqual(second.utf16) ? 0 : 1)
            case "compare-file-text":
                let url = try files.resolve(args[safe: 0] as? String ?? "")
                let encoding = args[safe: 1] as? String ?? ""
                let text = try files.coordinate(url) { try String(contentsOf: $0, encoding: FileContents.encoding(encoding.isEmpty ? "UTF-8" : encoding)) }
                let current = args[safe: 2] as? String ?? ""
                callback.success(text.utf16.elementsEqual(current.utf16) ? 0 : 1)
            case "fileExists", "getParentPath", "listChildren", "mkdirs", "writeText", "deleteFile", "createSymlink", "copyToUri", "extractAsset":
                callback.success(try SystemFiles.perform(action, args: args))
            default: callback.error(["code": "UNSUPPORTED_ACTION", "message": "System.\(action) is unavailable on iOS"])
            }
        } catch { callback.error(error.localizedDescription) }
    }
}

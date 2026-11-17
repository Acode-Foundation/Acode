import UIKit
import SafariServices
import Photos
import AVFoundation
import CoreHaptics
import Darwin
import DeviceKit

final class NativeService: BaseService {

    private var cameraCallback: Callback?
    private var intentObserver: NSObjectProtocol?
    private lazy var browser = SafariService(bridge: bridge!)
    private lazy var hapticGenerator = UIImpactFeedbackGenerator(style: .medium)
    private var hapticsEngine: CHHapticEngine?
    private let supportsHaptics: Bool = {
        if #available(iOS 13.0, *) {
            return CHHapticEngine.capabilitiesForHardware().supportsHaptics
        } else {
            return false
        }
    }()

    override func exec(action: String, args: [Any], callback: Callback) {
        switch action {
            case "shareFile":               shareFile(args: args, callback: callback)
            case "shareText":               shareText(args: args, callback: callback)
            case "getAppInfo":              getAppInfo(args: args, callback: callback)
            case "getDeviceInfo":           getDeviceInfo(args: args, callback: callback)
            case "getVersionSdkInt":        callback.success(0)
            case "openInBrowser":           openInBrowser(args: args, callback: callback)
            case "setIntentHandler":        setIntentHandler(args: args, callback: callback)
            case "setTheme":                setTheme(args: args, callback: callback)
            case "setSystemBarColor":       setSystemBarColor(args: args, callback: callback)
            case "getConfiguration":        getConfiguration(args: args, callback: callback)
            case "requestPermission":       requestPermission(args: args, callback: callback)
            case "requestPermissions":      requestPermissions(args: args, callback: callback)
            case "hasPermission":           hasPermission(args: args, callback: callback)
            case "captureFromCamera":       captureFromCamera(args: args, callback: callback)
            case "getIpAddresses":          getIpAddresses(args: args, callback: callback)
            case "hideSplashScreen":        callback.success()
            case "haptic":                  haptic(callback: callback)
            case "exitApp": exit(0)
            case "restartApp": callback.error("Programmatic app restart is unavailable on iOS")
            case "requestIgnoreBatteryOptimization": callback.success(1)
            default:                        callback.error("Unknown action: \(action)")
        }
    }

    // MARK: - shareFile / shareText

    private func shareFile(args: [Any], callback: Callback) {
        guard let share = bridge?.shareService else { callback.error("Native bridge unavailable"); return }
        share.exec(action: "shareFile", args: args, callback: callback)
    }

    private func shareText(args: [Any], callback: Callback) {
        guard let share = bridge?.shareService else { callback.error("Native bridge unavailable"); return }
        share.exec(action: "shareText", args: args, callback: callback)
    }

    // MARK: - getAppInfo

    private func getAppInfo(args: [Any], callback: Callback) {
        let info = Bundle.main.infoDictionary
        let result: [String: Any] = [
            "label":           info?["CFBundleDisplayName"] as? String ?? info?["CFBundleName"] as? String ?? "",
            "packageName":     Bundle.main.bundleIdentifier ?? "",
            "versionName":     info?["CFBundleShortVersionString"] as? String ?? "",
            "versionCode":     Int(info?["CFBundleVersion"] as? String ?? "0") ?? 0,
            "firstInstallTime": 0,
            "lastUpdateTime":  0,
        ]
        callback.success(result)
    }

    // MARK: - getDeviceInfo

    private func getDeviceInfo(args: [Any], callback: Callback) {
        let device = UIDevice.current
        let result: [String: Any] = [
            "manufacturer": "Apple",
            "model": Device.current.description,
            "product": device.name,
            "isEmulator": Device.current.isSimulator,
        ]
        callback.success(result)
    }

    // MARK: - openInBrowser

    private func openInBrowser(args: [Any], callback: Callback) {
        browser.exec(action: "open", args: args, callback: callback)
    }

    // MARK: - setIntentHandler

    private func setIntentHandler(args: [Any], callback: Callback) {
        if let existing = intentObserver {
            NotificationCenter.default.removeObserver(existing)
        }
        intentObserver = NotificationCenter.default.addObserver(
            forName: .acodeDeepLink, object: nil, queue: .main
        ) { notification in
            if let url = notification.object as? URL {
                callback.success(url.absoluteString, keep: true)
            }
        }
        callback.success(nil, keep: true)
    }

    // MARK: - setTheme / setSystemBarColor

    private func setTheme(args: [Any], callback: Callback) {
        let systemBarColor = args[safe: 0] as? String
        guard let theme = parseTheme(args[safe: 1]) ?? parseTheme(args[safe: 0]) else {
            callback.error("Invalid theme JSON"); return
        }
        DispatchQueue.main.async { [weak self] in
            let backgroundHex = systemBarColor ?? theme["primaryColor"] as? String
            if let backgroundHex, let color = UIColor(hexString: backgroundHex) {
                self?.viewController?.setSystemBarColor(color)
            }
            if let type = theme["type"] as? String {
                self?.viewController?.setThemeType(type)
            }
            callback.success()
        }
    }

    private func parseTheme(_ value: Any?) -> [String: Any]? {
        if let dict = value as? [String: Any] { return dict }
        if let themeStr = value as? String, let data = themeStr.data(using: .utf8) {
            return try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        }
        return nil
    }

    private func setSystemBarColor(args: [Any], callback: Callback) {
        DispatchQueue.main.async { [weak self] in
            self?.viewController?.setNeedsStatusBarAppearanceUpdate()
        }
        callback.success()
    }

    // MARK: - getConfiguration

    @available(iOS, deprecated: 26.0, message: "Migrate to effectiveGeometry.interfaceOrientation when targeting iOS 26+")
    private func getConfiguration(args: [Any], callback: Callback) {
        DispatchQueue.main.async { [weak self] in
            guard let self, let vc = self.viewController else { callback.error("No view controller"); return }
            let windowScene = UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }.first
            let orientation = windowScene?.interfaceOrientation.isPortrait == true ? "portrait" : "landscape"
            let locale = Locale.current.identifier.replacingOccurrences(of: "_", with: "-")
            let result: [String: Any] = [
                "keyboard":    vc.isKeyboardVisible,
                "orientation": orientation,
                "locale":      locale,
                "fontScale":   self.fontScale(),
            ]
            callback.success(result)
        }
    }

    private func fontScale() -> Double {
        switch UIApplication.shared.preferredContentSizeCategory {
        case .extraSmall:                           return 0.80
        case .small:                                return 0.85
        case .medium:                               return 0.90
        case .large:                                return 1.00
        case .extraLarge:                           return 1.10
        case .extraExtraLarge:                      return 1.20
        case .extraExtraExtraLarge:                 return 1.30
        case .accessibilityMedium:                  return 1.40
        case .accessibilityLarge:                   return 1.50
        case .accessibilityExtraLarge:              return 1.60
        case .accessibilityExtraExtraLarge:         return 1.70
        case .accessibilityExtraExtraExtraLarge:    return 2.00
        default:                                    return 1.00
        }
    }

    @available(iOS 13.0, *)
    private func startHapticsEngineIfNeeded() {
        guard supportsHaptics else { return }
        if hapticsEngine == nil {
            do {
                hapticsEngine = try CHHapticEngine()
            } catch {
                // Leave engine nil on failure; we'll fall back to UIFeedbackGenerator.
                return
            }
        }
        do {
            try hapticsEngine?.start()
        } catch {
            // Ignore start errors; fallback will be used.
        }
    }

    // MARK: - Permissions

    private enum PermissionKind {
        case camera, microphone, notifications, photoLibrary, unsupported
    }

    private func permissionKind(for name: String) -> PermissionKind {
        let lo = name.lowercased()
        if lo.contains("camera") { return .camera }
        if lo.contains("record_audio") || lo.contains("microphone") { return .microphone }
        if lo.contains("notification") { return .notifications }
        if lo.contains("photo") { return .photoLibrary }
        return .unsupported
    }

    private func requestPermission(args: [Any], callback: Callback) {
        guard let permission = args[safe: 0] as? String else {
            callback.error("Permission name required"); return
        }
        requestSinglePermission(permissionKind(for: permission), callback: callback)
    }

    private func requestPermissions(args: [Any], callback: Callback) {
        guard let permissions = args[safe: 0] as? [String] else {
            callback.error("Permissions array required"); return
        }
        requestNextPermission(Array(permissions), index: 0, callback: callback)
    }

    private func requestNextPermission(_ permissions: [String], index: Int, callback: Callback) {
        guard index < permissions.count else { callback.success(1); return }
        requestSinglePermission(permissionKind(for: permissions[index])) { [weak self] _ in
            self?.requestNextPermission(permissions, index: index + 1, callback: callback)
        }
    }

    private func requestSinglePermission(_ kind: PermissionKind, callback: Callback? = nil, completion: ((Bool) -> Void)? = nil) {
        let done: (Bool) -> Void = { granted in
            callback?.success(granted ? 1 : 0)
            completion?(granted)
        }
        switch kind {
        case .unsupported:
            callback?.error("This permission is unavailable on iOS; use the Files picker for document access")
            completion?(false)
        case .camera:
            AVCaptureDevice.requestAccess(for: .video) { done($0) }
        case .microphone:
            AVAudioApplication.requestRecordPermission { done($0) }
        case .notifications:
            UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { granted, _ in done(granted) }
        case .photoLibrary:
            PHPhotoLibrary.requestAuthorization(for: .readWrite) { status in
                done(status == .authorized || status == .limited)
            }
        }
    }

    private func hasPermission(args: [Any], callback: Callback) {
        guard let permission = args[safe: 0] as? String else {
            callback.error("Permission name required"); return
        }
        switch permissionKind(for: permission) {
        case .unsupported:
            callback.success(0)
        case .camera:
            callback.success(AVCaptureDevice.authorizationStatus(for: .video) == .authorized ? 1 : 0)
        case .microphone:
            callback.success(AVAudioApplication.shared.recordPermission == .granted ? 1 : 0)
        case .notifications:
            UNUserNotificationCenter.current().getNotificationSettings { settings in
                callback.success(settings.authorizationStatus == .authorized ? 1 : 0)
            }
        case .photoLibrary:
            let status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
            callback.success(status == .authorized || status == .limited ? 1 : 0)
        }
    }

    // MARK: - captureFromCamera

    private func captureFromCamera(args: [Any], callback: Callback) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self, let vc = self.viewController else { return }
            guard UIImagePickerController.isSourceTypeAvailable(.camera) else {
                callback.error("Camera not available"); return
            }
            self.cameraCallback = callback
            let picker = UIImagePickerController()
            picker.sourceType = .camera
            picker.delegate = self
            vc.present(picker, animated: true)
        }
    }

    // MARK: - getIpAddresses

    private func getIpAddresses(args: [Any], callback: Callback) {
        var addresses = [String]()
        var ifaddr: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&ifaddr) == 0 else { callback.success(addresses); return }
        defer { freeifaddrs(ifaddr) }
        var ptr = ifaddr
        while let ifa = ptr {
            defer { ptr = ifa.pointee.ifa_next }
            guard let addr = ifa.pointee.ifa_addr else { continue }
            let family = addr.pointee.sa_family
            guard family == UInt8(AF_INET) || family == UInt8(AF_INET6) else { continue }
            guard Int32(ifa.pointee.ifa_flags) & IFF_LOOPBACK == 0 else { continue }
            var hostname = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            getnameinfo(addr, socklen_t(addr.pointee.sa_len), &hostname, socklen_t(NI_MAXHOST), nil, 0, NI_NUMERICHOST)
            addresses.append(String(cString: hostname))
        }
        callback.success(addresses)
    }
}

// MARK: - Camera delegate

extension NativeService: UIImagePickerControllerDelegate, UINavigationControllerDelegate {
    func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
        picker.dismiss(animated: true)
        guard let image = info[.originalImage] as? UIImage,
              let data = image.jpegData(compressionQuality: 0.9) else {
            cameraCallback?.error("Failed to capture image")
            cameraCallback = nil
            return
        }
        let fileName = "capture_\(Int(Date().timeIntervalSince1970)).jpg"
        let destURL = FileManager.default.temporaryDirectory.appendingPathComponent(fileName)
        do {
            try data.write(to: destURL)
            cameraCallback?.success(destURL.path)
        } catch {
            cameraCallback?.error(error.localizedDescription)
        }
        cameraCallback = nil
    }

    func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
        picker.dismiss(animated: true)
        cameraCallback?.error("Cancelled")
        cameraCallback = nil
    }

    private func haptic(callback: Callback) {
        DispatchQueue.main.async {
            if #available(iOS 13.0, *), self.supportsHaptics {
                self.startHapticsEngineIfNeeded()
                if let engine = self.hapticsEngine {
                    do {
                        let intensity = CHHapticEventParameter(parameterID: .hapticIntensity, value: 1.0)
                        let sharpness = CHHapticEventParameter(parameterID: .hapticSharpness, value: 0.5)
                        let event = CHHapticEvent(eventType: .hapticTransient, parameters: [intensity, sharpness], relativeTime: 0)
                        let pattern = try CHHapticPattern(events: [event], parameters: [])
                        let player = try engine.makePlayer(with: pattern)
                        try player.start(atTime: 0)
                        callback.success()
                        return
                    } catch {
                        // Fall back to UIFeedbackGenerator below on any error.
                    }
                }
            }
            // Fallback for devices without Core Haptics or if starting/playing the engine failed.
            let generator = UIImpactFeedbackGenerator(style: .medium)
            generator.prepare()
            generator.impactOccurred()
            callback.success()
        }
    }
}

// MARK: - Notification name

extension Notification.Name {
    static let acodeDeepLink = Notification.Name("acodeDeepLink")
}

import UserNotifications

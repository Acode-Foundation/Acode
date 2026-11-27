import UIKit

enum AppIconService {
    static func set(_ name: String, callback: Callback) {
        DispatchQueue.main.async {
            let application = UIApplication.shared
            let key = name.lowercased()
            let icon = key == "default" ? nil : "ic_acode_" + key
            let icons = Bundle.main.object(forInfoDictionaryKey: "CFBundleIcons") as? [String: Any]
            let alternatives = icons?["CFBundleAlternateIcons"] as? [String: Any] ?? [:]
            if let icon, alternatives[icon] == nil { callback.error("Unknown app icon: " + name); return }
            guard application.supportsAlternateIcons else { callback.error("Alternate app icons are unavailable on this device"); return }
            if application.alternateIconName == icon { callback.success(); return }
            application.setAlternateIconName(icon) { error in
                if let error { callback.error(error.localizedDescription) }
                else { callback.success() }
            }
        }
    }
}

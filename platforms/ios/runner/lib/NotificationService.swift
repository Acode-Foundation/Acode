import UserNotifications
import UIKit

final class NotificationService: BaseService {

    // Shared instance used by AppDelegate's UNUserNotificationCenterDelegate.
    static weak var shared: NotificationService?

    private struct NotificationEntry {
        let content: UNMutableNotificationContent
        var tapCallback: Callback?
    }

    private var registry: [Int: NotificationEntry] = [:]
    private var nextId = 1

    required init(bridge: Bridge) {
        super.init(bridge: bridge)
        NotificationService.shared = self
    }

    override func exec(action: String, args: [Any], callback: Callback) {
        switch action {
        case "create":      create(args: args, callback: callback)
        case "show":        show(args: args, callback: callback)
        case "hide":        hide(args: args, callback: callback)
        case "delete":      deleteNotification(args: args, callback: callback)
        case "addListener": addListener(args: args, callback: callback)
        default:            callback.error("Unknown action: \(action)")
        }
    }

    // MARK: - create

    private func create(args: [Any], callback: Callback) {
        guard let title   = args[safe: 0] as? String,
              let message = args[safe: 1] as? String else {
            callback.error("title and message required"); return
        }
        let content = UNMutableNotificationContent()
        content.title = title
        content.body  = message
        content.sound = .default
        // Apply optional options (icon/vibrate ignored on iOS)
        if let optStr = args[safe: 2] as? String,
           let data = optStr.data(using: .utf8),
           let opts = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            if let badge = opts["badge"] as? Int {
                content.badge = NSNumber(value: badge)
            }
        }
        let id = nextId
        nextId += 1
        registry[id] = NotificationEntry(content: content)
        callback.success(id)
    }

    // MARK: - show

    private func show(args: [Any], callback: Callback) {
        guard let id = args[safe: 0] as? Int,
              let entry = registry[id] else {
            callback.error("Invalid notification id"); return
        }
        let request = UNNotificationRequest(
            identifier: String(id),
            content: entry.content,
            trigger: nil
        )
        UNUserNotificationCenter.current().add(request) { error in
            if let error = error { callback.error(error.localizedDescription) }
            else { callback.success() }
        }
    }

    // MARK: - hide

    private func hide(args: [Any], callback: Callback) {
        guard let id = args[safe: 0] as? Int else { callback.error("id required"); return }
        UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: [String(id)])
        callback.success()
    }

    // MARK: - deleteNotification

    private func deleteNotification(args: [Any], callback: Callback) {
        guard let id = args[safe: 0] as? Int else { callback.error("id required"); return }
        let strId = String(id)
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [strId])
        UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: [strId])
        registry.removeValue(forKey: id)
        callback.success()
    }

    // MARK: - addListener

    private func addListener(args: [Any], callback: Callback) {
        guard let id = args[safe: 0] as? Int else { callback.error("id required"); return }
        registry[id]?.tapCallback = callback
        callback.success(nil, keep: true)
    }

    // MARK: - Tap handler (called by AppDelegate's UNUserNotificationCenterDelegate)

    func handleNotificationTap(response: UNNotificationResponse) {
        guard let id = Int(response.notification.request.identifier) else { return }
        registry[id]?.tapCallback?.success(id, keep: true)
    }
}

// MARK: - UNUserNotificationCenterDelegate

extension NotificationService: UNUserNotificationCenterDelegate {
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        handleNotificationTap(response: response)
        completionHandler()
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound, .badge])
    }
}

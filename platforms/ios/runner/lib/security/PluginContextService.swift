import Foundation

final class PluginContextService: BaseService {
    private let sessions = PluginSessions()

    override func reset() { sessions.reset() }

    override func exec(action: String, args: [Any], callback: Callback) {
        do {
            let token = args[safe: 0] as? String ?? ""
            switch action {
            case "establishConnection": callback.success(try sessions.establish())
            case "requestToken": callback.success(try sessions.issue(session: token, pluginID: args[safe: 1] as? String ?? "", manifest: args[safe: 2] as? String ?? ""))
            case "invalidate": try sessions.invalidate(token); callback.success()
            case "grantedPermission": callback.success(try sessions.permissions(for: token).contains(args[safe: 1] as? String ?? "") ? 1 : 0)
            case "listAllPermissions": callback.success(try sessions.permissions(for: token))
            case "get_secret", "set_secret", "delete_secret", "clear_all_secrets":
                let pluginID = try sessions.plugin(for: token)
                let store = SecretStore(namespace: "plugin." + Data(pluginID.utf8).base64EncodedString())
                let key = args[safe: 1] as? String ?? ""
                switch action {
                case "get_secret": callback.success(try store.get(key, default: args[safe: 2] as? String ?? ""))
                case "set_secret": try store.set(key, value: args[safe: 2] as? String ?? ""); callback.success()
                case "delete_secret": try store.remove(key); callback.success()
                default: try store.clear(); callback.success()
                }
            default: callback.error("Unknown plugin context action: \(action)")
            }
        } catch { callback.error(error.localizedDescription) }
    }
}

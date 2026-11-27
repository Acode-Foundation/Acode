import Foundation

final class PluginSessions {
    private var session: String?
    private var plugins: [String: (token: String, permissions: [String])] = [:]

    func establish() throws -> String {
        guard session == nil else { throw SecretFailure("CONNECTION_ALREADY_ESTABLISHED") }
        let token = try SecureToken.generate()
        session = token
        return token
    }

    func issue(session: String, pluginID: String, manifest: String) throws -> String {
        guard SecureToken.matches(session, self.session) else { throw SecretFailure("INVALID_SESSION") }
        guard !pluginID.isEmpty, let data = manifest.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw SecretFailure("INVALID_PLUGIN_JSON") }
        let permissions: [String]
        if let requested = json["permissions"], !(requested is NSNull) {
            guard let values = requested as? [String] else { throw SecretFailure("INVALID_PLUGIN_JSON") }
            permissions = values
        } else { permissions = [] }
        let token = try plugins[pluginID]?.token ?? SecureToken.generate()
        plugins[pluginID] = (token, permissions)
        return token
    }

    func plugin(for token: String) throws -> String {
        guard let plugin = plugins.first(where: { SecureToken.matches($0.value.token, token) })?.key else { throw SecretFailure("INVALID_TOKEN") }
        return plugin
    }

    func permissions(for token: String) throws -> [String] { plugins[try plugin(for: token)]!.permissions }
    func invalidate(_ token: String) throws { plugins.removeValue(forKey: try plugin(for: token)) }
    func reset() { session = nil; plugins.removeAll() }
}

import WebKit

final class PluginWebViewService: BaseService {
    private var instances: [String: PluginWebView] = [:]
    private var messageCallback: Callback?

    override func reset() {
        DispatchQueue.main.async {
            for instance in self.instances.values { instance.destroy() }
            self.instances.removeAll()
            self.messageCallback?.release(); self.messageCallback = nil
        }
    }

    override func exec(action: String, args: [Any], callback: Callback) {
        DispatchQueue.main.async { [self] in
            if action == "setMessageCallback" {
                self.messageCallback?.release(); self.messageCallback = callback; return
            }
            if action == "create" {
                let options = args[safe: 0] as? [String: Any] ?? [:]
                guard ["hidden", "fullscreen"].contains(options["mode"] as? String ?? "hidden") else { callback.error("Unsupported WebView mode"); return }
                let instance = PluginWebView(options: options)
                instance.controller.auxiliaryPresenter = self.viewController
                self.instances[instance.id] = instance
                instance.emit = { [weak self] payload in self?.messageCallback?.success(payload, keep: true) }
                instance.controller.onClose = { [weak self, weak instance] in
                    guard let instance else { return }
                    instance.event("closed")
                    self?.instances.removeValue(forKey: instance.id)
                    instance.destroy()
                }
                if instance.fullscreen, options["visible"] as? Bool ?? true {
                    guard let presenter = self.viewController, presenter.presentedViewController == nil else {
                        self.instances.removeValue(forKey: instance.id); instance.destroy(); callback.error("A WebView cannot be presented right now"); return
                    }
                    instance.show(from: presenter)
                }
                callback.success(instance.id)
                return
            }
            guard let id = args[safe: 0] as? String, let instance = self.instances[id] else { callback.error("WebView not found"); return }
            switch action {
            case "loadURL":
                guard let value = args[safe: 1] as? String, let url = self.sanitizedURL(value) else { callback.error("Only HTTP and HTTPS URLs are allowed"); return }
                instance.load(url); callback.success()
            case "loadHTML": instance.loadHTML(args[safe: 1] as? String ?? ""); callback.success()
            case "evaluate": instance.evaluate(args[safe: 1] as? String ?? "", callback: callback)
            case "postMessage": instance.post(args[safe: 1] as? String ?? "", callback: callback)
            case "show":
                guard let presenter = self.viewController else { callback.error("View unavailable"); return }
                instance.show(from: presenter, callback: callback)
            case "hide": instance.hide(callback: callback)
            case "reload": instance.reload(callback: callback)
            case "destroy": self.instances.removeValue(forKey: id); instance.destroy { callback.success() }
            default: callback.error("Unknown WebView action: \(action)")
            }
        }
    }

    private func sanitizedURL(_ value: String) -> URL? {
        let value = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return nil }
        let explicit = value.range(of: "^[a-zA-Z][a-zA-Z0-9+.-]*:", options: .regularExpression) != nil
        let hostPort = value.range(of: "^[^/:]+:[0-9]+(?:/|$)", options: .regularExpression) != nil
        let input = explicit && !hostPort ? value : "https://" + value
        guard let url = URL(string: input), ["http", "https"].contains(url.scheme?.lowercased() ?? ""), url.host != nil else { return nil }
        return url
    }
}

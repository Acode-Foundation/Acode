import UIKit
import WebKit

extension PreviewViewController {
    @objc func goBack() {
        if consoleVisible { setConsoleVisible(false) }
        else { webView.goBack() }
    }

    @objc func goForward() { webView.goForward() }

    @objc func refresh() {
        prepareNavigation { [weak self] in
            guard let self else { return }
            if self.disableCache { self.webView.reloadFromOrigin() }
            else { self.webView.reload() }
        }
    }

    func setConsoleVisible(_ visible: Bool) {
        consoleVisible = visible
        webView.evaluateJavaScript("document.dispatchEvent(new CustomEvent('\(visible ? "show" : "hide")console'))")
        updateMenu()
    }

    func updateMenu() {
        var actions: [UIMenuElement] = [
            UIAction(title: "Devices", image: UIImage(systemName: "display"), state: viewport == nil ? .off : .on) { [weak self] _ in self?.showDevices() },
            UIAction(title: "Disable Cache", image: UIImage(systemName: "arrow.triangle.2.circlepath"), state: disableCache ? .on : .off) { [weak self] _ in
                guard let self else { return }; self.disableCache.toggle(); self.updateMenu(); self.refresh()
            },
        ]
        if consoleAvailable, viewport == nil {
            actions.append(UIAction(title: "Console", image: UIImage(systemName: "terminal"), state: consoleVisible ? .on : .off) { [weak self] _ in
                guard let self else { return }; self.setConsoleVisible(!self.consoleVisible)
            })
        }
        actions.append(UIAction(title: "Open in Browser", image: UIImage(systemName: "safari")) { [weak self] _ in
            guard let self, let url = self.webView.url, ["http", "https"].contains(url.scheme ?? "") else { return }
            if let onExternal = self.onExternal { onExternal(url); self.close() }
            else { UIApplication.shared.open(url) { [weak self] opened in if opened { self?.close() } } }
        })
        actions.append(UIAction(title: "Exit", image: UIImage(systemName: "xmark")) { [weak self] _ in self?.close() })
        actions.append(UIMenu(options: .displayInline, children: [
            UIAction(title: "Back", image: UIImage(systemName: "chevron.left"), attributes: webView.canGoBack || consoleVisible ? [] : .disabled) { [weak self] _ in self?.goBack() },
            UIAction(title: "Forward", image: UIImage(systemName: "chevron.right"), attributes: webView.canGoForward ? [] : .disabled) { [weak self] _ in self?.goForward() },
        ]))
        menuButton.menu = UIMenu(children: actions)
    }

    func applyViewport(_ size: CGSize?, scale: CGFloat = 1) {
        let modeChanged = (viewport == nil) != (size == nil)
        viewport = size
        viewportScale = scale
        if size != nil { setConsoleVisible(false) }
        webView.configuration.defaultWebpagePreferences.preferredContentMode = size == nil ? .mobile : .desktop
        view.setNeedsLayout()
        updateMenu()
        if modeChanged { refresh() }
    }

    private func showDevices() {
        let devices = PreviewDevicesController(size: viewport ?? content.bounds.size, scale: viewportScale)
        devices.onChange = { [weak self] size, scale in self?.applyViewport(size, scale: scale) }
        let navigation = UINavigationController(rootViewController: devices)
        navigation.sheetPresentationController?.detents = [.medium(), .large()]
        present(navigation, animated: true)
    }
}

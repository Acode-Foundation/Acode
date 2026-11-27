import UIKit
import WebKit

@MainActor
final class WebFullscreen: NSObject {
    private weak var controller: WebViewController?
    private weak var scene: UIWindowScene?
    private var observation: NSKeyValueObservation?
    private var task: Task<Void, Never>?
    private var pending: Callback?
    private var requestID = UUID()
    private var foreground = true
    private var controls: FullscreenBackControls!
    private var hasBackHandler = false
    var isFullscreen: Bool {
        let state = controller?.webView.fullscreenState
        return controller?.isFullscreenLayout == true || state == .inFullscreen || state == .enteringFullscreen
    }
    private(set) var requestedOrientation: UIInterfaceOrientationMask?

    init(controller: WebViewController) {
        self.controller = controller
        super.init()
        controls = FullscreenBackControls(controller: controller) { [weak self] in self?.back() }
        observation = controller.webView.observe(\.fullscreenState, options: [.new]) { [weak self] webView, _ in
            MainActor.assumeIsolated {
                guard let self, self.controller?.isFullscreenLayout != true else { return }
                if webView.fullscreenState == .notInFullscreen || webView.fullscreenState == .exitingFullscreen {
                    self.hasBackHandler = false
                    self.reset()
                }
            }
        }
        NotificationCenter.default.addObserver(self, selector: #selector(pause), name: UIApplication.willResignActiveNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(resume), name: UIApplication.didBecomeActiveNotification, object: nil)
    }

    func setActive(_ active: Bool, callback: Callback? = nil) {
        guard !active || foreground else { callback?.error("Fullscreen requires the foreground app."); return }
        if !active { hasBackHandler = false; reset() }
        controller?.setFullscreenLayout(active)
        callback?.success()
    }

    func setBackHandler(_ enabled: Bool, callback: Callback) {
        guard !enabled || (foreground && isFullscreen) else {
            callback.error("Back handler requires foreground fullscreen."); return
        }
        hasBackHandler = enabled
        callback.success()
    }

    func updateControls() {
        controls.update(active: controller?.isFullscreenLayout == true, enabled: foreground, theme: controller?.themeType ?? "dark")
    }

    func back() {
        guard foreground, isFullscreen else { return }
        let script = hasBackHandler
            ? "document.dispatchEvent(new Event('fullscreenbackbutton'));"
            : "Promise.resolve(document.exitFullscreen()).catch(console.error);"
        controller?.webView.evaluateJavaScript(script, completionHandler: nil)
    }

    func setOrientation(_ value: Any?, callback: Callback) {
        guard let value, !(value is NSNull) else { reset(); callback.success(); return }
        let mask: UIInterfaceOrientationMask
        switch value as? String {
        case "landscape": mask = .landscape
        case "portrait": mask = UIDevice.current.userInterfaceIdiom == .pad ? [.portrait, .portraitUpsideDown] : .portrait
        default: callback.error("Orientation must be landscape or portrait."); return
        }
        guard foreground, isFullscreen, let scene = controller?.view.window?.windowScene,
              scene.activationState == .foregroundActive else {
            callback.error("Orientation requires foreground fullscreen."); return
        }
        self.scene = scene
        cancelPending()
        requestedOrientation = mask
        pending = callback
        apply(mask, scene: scene)
    }

    func reset() {
        cancelPending()
        requestedOrientation = nil
        restorePolicy()
    }

    @objc private func pause() {
        foreground = false
        updateControls()
        if pending != nil { reset() }
        else { cancelPending(); restorePolicy() }
    }

    @objc private func resume() {
        foreground = true
        updateControls()
        if let mask = requestedOrientation, isFullscreen, let scene { apply(mask, scene: scene) }
    }

    private func apply(_ mask: UIInterfaceOrientationMask, scene: UIWindowScene) {
        let id = UUID()
        requestID = id
        AppDelegate.shared?.fullscreenOrientation = mask
        updateControllers()
        scene.requestGeometryUpdate(.iOS(interfaceOrientations: mask)) { [weak self] error in
            self?.fail(error.localizedDescription, request: id)
        }
        task = Task { [weak self, weak scene] in
            for _ in 0..<150 {
                do { try await Task.sleep(for: .milliseconds(20)) } catch { return }
                guard let self, let scene, self.requestID == id else { return }
                guard self.foreground, self.isFullscreen, scene.activationState == .foregroundActive else {
                    self.fail("Fullscreen session changed.", request: id); return
                }
                let orientation = scene.effectiveGeometry.interfaceOrientation
                if mask.contains(UIInterfaceOrientationMask(rawValue: 1 << orientation.rawValue)) {
                    let callback = self.pending; self.pending = nil
                    self.task = nil
                    callback?.success()
                    return
                }
            }
            self?.fail("iOS could not apply this orientation.", request: id)
        }
    }

    private func fail(_ message: String, request: UUID) {
        guard requestID == request else { return }
        let callback = pending; pending = nil
        reset()
        callback?.error(message)
    }

    private func cancelPending() {
        requestID = UUID()
        task?.cancel(); task = nil
        pending?.error("Fullscreen orientation request cancelled."); pending = nil
    }

    private func restorePolicy() {
        guard AppDelegate.shared?.fullscreenOrientation != nil else { return }
        AppDelegate.shared?.fullscreenOrientation = nil
        updateControllers()
        let normal: UIInterfaceOrientationMask = UIDevice.current.userInterfaceIdiom == .pad ? .all : .allButUpsideDown
        scene?.requestGeometryUpdate(.iOS(interfaceOrientations: normal))
    }

    private func updateControllers() {
        controller?.setNeedsUpdateOfSupportedInterfaceOrientations()
        for window in scene?.windows ?? [] {
            var current = window.rootViewController
            while let controller = current {
                controller.setNeedsUpdateOfSupportedInterfaceOrientations()
                current = controller.presentedViewController
            }
        }
    }

    deinit { NotificationCenter.default.removeObserver(self) }
}

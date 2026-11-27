import UIKit

@MainActor
final class FullscreenBackControls: NSObject, UIGestureRecognizerDelegate {
    private let button = UIButton(type: .system)
    private let gesture = UIScreenEdgePanGestureRecognizer()
    private let revealGesture = UIPanGestureRecognizer()
    private let action: () -> Void
    private var available = false
    private var hideTask: Task<Void, Never>?

    init(controller: UIViewController, action: @escaping () -> Void) {
        self.action = action
        super.init()
        var configuration = UIButton.Configuration.gray()
        configuration.image = UIImage(systemName: "chevron.left")
        configuration.baseForegroundColor = .label
        configuration.background.backgroundColor = .secondarySystemBackground
        configuration.cornerStyle = .capsule
        button.configuration = configuration
        button.accessibilityLabel = "Back"
        button.accessibilityIdentifier = "fullscreen-back"
        button.isHidden = true
        button.addTarget(self, action: #selector(back), for: .touchUpInside)
        controller.view.addSubview(button)
        button.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            button.widthAnchor.constraint(equalToConstant: 44),
            button.heightAnchor.constraint(equalToConstant: 44),
            button.leadingAnchor.constraint(equalTo: controller.view.safeAreaLayoutGuide.leadingAnchor, constant: 8),
            button.topAnchor.constraint(equalTo: controller.view.safeAreaLayoutGuide.topAnchor, constant: 8),
        ])
        gesture.edges = .left
        gesture.isEnabled = false
        gesture.delegate = self
        gesture.addTarget(self, action: #selector(swiped))
        controller.view.addGestureRecognizer(gesture)
        revealGesture.isEnabled = false
        revealGesture.delegate = self
        revealGesture.maximumNumberOfTouches = 1
        revealGesture.addTarget(self, action: #selector(revealed))
        controller.view.addGestureRecognizer(revealGesture)
    }

    func update(active: Bool, enabled: Bool, theme: String) {
        available = active && enabled
        if !available { hide() }
        button.isEnabled = available
        button.overrideUserInterfaceStyle = theme == "light" ? .light : .dark
        gesture.isEnabled = available
        revealGesture.isEnabled = available
    }

    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
        guard gestureRecognizer === revealGesture, let view = revealGesture.view else { return true }
        return touch.location(in: view).y <= view.safeAreaInsets.top + 44
    }

    func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        if gestureRecognizer === revealGesture {
            let velocity = revealGesture.velocity(in: revealGesture.view)
            return velocity.y > abs(velocity.x)
        }
        let velocity = gesture.velocity(in: gesture.view)
        return velocity.x > abs(velocity.y)
    }

    @objc private func back() {
        show()
        action()
    }

    @objc private func revealed() {
        let translation = revealGesture.translation(in: revealGesture.view)
        if revealGesture.state == .ended, translation.y >= 40, translation.y > abs(translation.x) {
            show()
        }
    }

    @objc private func swiped() {
        let translation = gesture.translation(in: gesture.view)
        if gesture.state == .ended, translation.x >= 60, translation.x > abs(translation.y) {
            action()
        }
    }

    private func show() {
        guard available else { return }
        hideTask?.cancel()
        button.isHidden = false
        hideTask = Task { [weak self] in
            do { try await Task.sleep(for: .seconds(3)) } catch { return }
            guard !Task.isCancelled else { return }
            self?.hide()
        }
    }

    private func hide() {
        hideTask?.cancel()
        hideTask = nil
        button.isHidden = true
    }

    deinit { hideTask?.cancel() }
}

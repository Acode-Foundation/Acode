import UIKit

enum SSHPrompts {
    static func confirm(title: String, message: String, button: String, destructive: Bool = false, presenter: @escaping () -> UIViewController?, cancellation: SSHCancellation) throws -> Bool {
        let decision = SSHDecision()
        DispatchQueue.main.async {
            guard (try? cancellation.check()) != nil, let presenter = presenter(), presenter.presentedViewController == nil else { decision.complete(false); return }
            let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
            decision.alert = alert
            alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in decision.complete(false) })
            alert.addAction(UIAlertAction(title: button, style: destructive ? .destructive : .default) { _ in decision.complete(true) })
            presenter.present(alert, animated: true)
        }
        do {
            while decision.signal.wait(timeout: .now() + .milliseconds(50)) == .timedOut { try cancellation.check() }
            try cancellation.check()
            return decision.accepted
        } catch {
            DispatchQueue.main.async { decision.alert?.dismiss(animated: true) }
            throw error
        }
    }

    static func changed(_ failure: SSHFailure, presenter: @escaping () -> UIViewController?) {
        guard failure.payload["code"] as? String == "HOST_KEY_CHANGED" else { return }
        DispatchQueue.main.async {
            guard let presenter = presenter(), presenter.presentedViewController == nil else { return }
            let message = "The identity of \(failure.payload["host"] ?? "") has changed. The connection was blocked.\n\nExpected: \(failure.payload["expectedFingerprint"] ?? "")\nReceived: \(failure.payload["fingerprint"] ?? "")"
            let alert = UIAlertController(title: "SSH host key changed", message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "Close", style: .default))
            presenter.present(alert, animated: true)
        }
    }
}

private final class SSHDecision {
    let signal = DispatchSemaphore(value: 0)
    var accepted = false
    weak var alert: UIAlertController?
    func complete(_ value: Bool) { accepted = value; signal.signal() }
}

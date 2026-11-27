import UIKit

final class DialogService: BaseService {

    override func exec(action: String, args: [Any], callback: Callback) {
        switch action {
        case "alert":   alert(args: args, callback: callback)
        case "confirm": confirm(args: args, callback: callback)
        case "prompt":  prompt(args: args, callback: callback)
        default:        callback.error("Unknown action: \(action)")
        }
    }

    // MARK: - alert

    private func alert(args: [Any], callback: Callback) {
        let message = args[safe: 0] as? String ?? ""
        let title   = args[safe: 1] as? String ?? ""

        DispatchQueue.main.async { [weak self] in
            guard let vc = self?.viewController else {
                callback.error("No view controller"); return
            }
            let alert = UIAlertController(
                title:          title.isEmpty ? nil : title,
                message:        message,
                preferredStyle: .alert
            )
            alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in
                callback.success()
            })
            vc.present(alert, animated: true)
        }
    }

    // MARK: - confirm

    private func confirm(args: [Any], callback: Callback) {
        let message = args[safe: 0] as? String ?? ""
        let title   = args[safe: 1] as? String ?? ""

        DispatchQueue.main.async { [weak self] in
            guard let vc = self?.viewController else {
                callback.error("No view controller"); return
            }
            let alert = UIAlertController(
                title:          title.isEmpty ? nil : title,
                message:        message,
                preferredStyle: .alert
            )
            alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in
                callback.success(true)
            })
            alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in
                callback.success(false)
            })
            vc.present(alert, animated: true)
        }
    }

    // MARK: - prompt

    private func prompt(args: [Any], callback: Callback) {
        let message      = args[safe: 0] as? String ?? ""
        let defaultValue = args[safe: 1] as? String ?? ""
        let title        = args[safe: 2] as? String ?? ""

        DispatchQueue.main.async { [weak self] in
            guard let vc = self?.viewController else {
                callback.error("No view controller"); return
            }
            let alert = UIAlertController(
                title:          title.isEmpty ? nil : title,
                message:        message,
                preferredStyle: .alert
            )
            alert.addTextField { textField in
                textField.text = defaultValue
                textField.autocorrectionType = .no
            }
            alert.addAction(UIAlertAction(title: "OK", style: .default) { [weak alert] _ in
                let text = alert?.textFields?.first?.text ?? ""
                callback.success(text)
            })
            alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in
                callback.success(nil as String?)
            })
            vc.present(alert, animated: true)
        }
    }
}

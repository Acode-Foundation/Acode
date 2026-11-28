import UIKit

@MainActor
enum AMBPrivacyProgress {
    static func show(in container: UIView?) -> () -> Void {
        guard let container else { return {} }
        let panel = UIVisualEffectView(effect: UIBlurEffect(style: .systemMaterial))
        panel.translatesAutoresizingMaskIntoConstraints = false
        panel.layer.cornerRadius = 16
        panel.clipsToBounds = true
        panel.isUserInteractionEnabled = false

        let spinner = UIActivityIndicatorView(style: .medium)
        spinner.startAnimating()
        let label = UILabel()
        label.text = NSLocalizedString("Waiting for iOS privacy permission…", comment: "Progress while waiting for the tracking permission dialog")
        label.font = .preferredFont(forTextStyle: .subheadline)
        label.adjustsFontForContentSizeCategory = true
        label.numberOfLines = 0

        let content = UIStackView(arrangedSubviews: [spinner, label])
        content.translatesAutoresizingMaskIntoConstraints = false
        content.alignment = .center
        content.spacing = 12
        panel.contentView.addSubview(content)
        container.addSubview(panel)
        NSLayoutConstraint.activate([
            panel.centerXAnchor.constraint(equalTo: container.safeAreaLayoutGuide.centerXAnchor),
            panel.bottomAnchor.constraint(equalTo: container.safeAreaLayoutGuide.bottomAnchor, constant: -24),
            panel.leadingAnchor.constraint(greaterThanOrEqualTo: container.safeAreaLayoutGuide.leadingAnchor, constant: 20),
            panel.trailingAnchor.constraint(lessThanOrEqualTo: container.safeAreaLayoutGuide.trailingAnchor, constant: -20),
            panel.widthAnchor.constraint(lessThanOrEqualToConstant: 360),
            content.leadingAnchor.constraint(equalTo: panel.contentView.leadingAnchor, constant: 16),
            content.trailingAnchor.constraint(equalTo: panel.contentView.trailingAnchor, constant: -16),
            content.topAnchor.constraint(equalTo: panel.contentView.topAnchor, constant: 16),
            content.bottomAnchor.constraint(equalTo: panel.contentView.bottomAnchor, constant: -16),
        ])
        UIAccessibility.post(notification: .announcement, argument: label.text)
        return { panel.removeFromSuperview() }
    }
}

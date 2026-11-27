import CoreText
import UIKit
import WebKit

extension PreviewViewController {
    func configureToolbar(foreground: UIColor) {
        toolbar.alignment = .center
        toolbar.isLayoutMarginsRelativeArrangement = true
        toolbar.layoutMargins = UIEdgeInsets(top: 0, left: 5, bottom: 0, right: 5)
        let close = toolbarButton("\u{e965}", label: "Close preview", action: #selector(close))
        let icon = UIImageView(image: PreviewIcons.image("\u{ea0d}"))
        icon.contentMode = .center
        let indicator = UIView()
        indicator.addSubview(icon)
        indicator.addSubview(progress)
        progress.color = foreground
        for child in [icon, progress] {
            child.translatesAutoresizingMaskIntoConstraints = false
            NSLayoutConstraint.activate([
                child.centerXAnchor.constraint(equalTo: indicator.centerXAnchor),
                child.centerYAnchor.constraint(equalTo: indicator.centerYAnchor),
            ])
        }
        indicator.widthAnchor.constraint(equalToConstant: 35).isActive = true
        indicator.heightAnchor.constraint(equalToConstant: 35).isActive = true
        address.delegate = self
        address.textColor = foreground
        address.font = .systemFont(ofSize: 16)
        address.keyboardType = .URL
        address.returnKeyType = .go
        address.autocapitalizationType = .none
        address.autocorrectionType = .no
        address.clearButtonMode = .whileEditing
        address.isEnabled = !consoleOnly
        address.accessibilityLabel = consoleOnly ? "Console title" : "Preview address"
        address.setContentHuggingPriority(.defaultLow, for: .horizontal)
        address.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        address.heightAnchor.constraint(equalToConstant: 35).isActive = true
        if !consoleOnly {
            address.backgroundColor = foreground.withAlphaComponent(0.067)
            address.layer.cornerRadius = 17.5
            address.leftView = UIView(frame: CGRect(x: 0, y: 0, width: 17.5, height: 1))
            address.leftViewMode = .always
        }
        for child in [close, indicator, address] { toolbar.addArrangedSubview(child) }
        if !consoleOnly || !consoleEnabled {
            toolbar.addArrangedSubview(toolbarButton("\u{e9b3}", label: "Refresh", action: #selector(refresh)))
        }
        menuButton.setImage(PreviewIcons.image("\u{e9b2}"), for: .normal)
        menuButton.accessibilityLabel = "Preview menu"
        menuButton.showsMenuAsPrimaryAction = true
        menuButton.widthAnchor.constraint(equalToConstant: 35).isActive = true
        menuButton.heightAnchor.constraint(equalToConstant: 45).isActive = true
        if !consoleOnly && showTools { toolbar.addArrangedSubview(menuButton) }
        updateAddress()
    }

    func updateAddress() {
        guard !address.isFirstResponder else { return }
        address.text = title ?? webView.title.flatMap { $0.isEmpty ? nil : $0 }
            ?? (consoleOnly ? "Console" : webView.url?.absoluteString ?? initialURL.absoluteString)
    }

    private func toolbarButton(_ glyph: String, label: String, action: Selector) -> UIButton {
        let button = UIButton(type: .system)
        button.setImage(PreviewIcons.image(glyph), for: .normal)
        button.accessibilityLabel = label
        button.addTarget(self, action: action, for: .touchUpInside)
        button.widthAnchor.constraint(equalToConstant: 35).isActive = true
        button.heightAnchor.constraint(equalToConstant: 45).isActive = true
        return button
    }
}

@MainActor
private enum PreviewIcons {
    static let font: UIFont? = {
        let url = Bundle.main.bundleURL.appendingPathComponent("bundle/build/icons.ttf")
        guard let provider = CGDataProvider(url: url as CFURL), let font = CGFont(provider), let name = font.postScriptName else { return nil }
        CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
        return UIFont(name: name as String, size: 21)
    }()

    static func image(_ glyph: String) -> UIImage? {
        guard let font else { return nil }
        let text = NSAttributedString(string: glyph, attributes: [.font: font, .foregroundColor: UIColor.white])
        return UIGraphicsImageRenderer(size: CGSize(width: 24, height: 24)).image { _ in
            let size = text.size()
            text.draw(at: CGPoint(x: (24 - size.width) / 2, y: (24 - size.height) / 2))
        }.withRenderingMode(.alwaysTemplate)
    }
}

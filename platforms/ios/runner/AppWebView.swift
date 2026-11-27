import WebKit

final class AppWebView: WKWebView {
    var nativeContextMenuDisabled = false {
        didSet { UIMenuSystem.context.setNeedsRebuild() }
    }

    override var inputAccessoryView: UIView? { nil }

    override func buildMenu(with builder: UIMenuBuilder) {
        super.buildMenu(with: builder)
        if nativeContextMenuDisabled && builder.system === UIMenuSystem.context {
            builder.replaceChildren(ofMenu: .root) { _ in [] }
        }
    }
}

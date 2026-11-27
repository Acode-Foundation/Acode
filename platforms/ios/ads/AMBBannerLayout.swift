import GoogleMobileAds
import UIKit

final class AMBBannerLayout {
    private weak var plugin: AMBPlugin?
    private var banners: [AMBBanner] = []
    private var marginTop: CGFloat = 0
    private var marginBottom: CGFloat = 0
    private var layingOut = false

    init(plugin: AMBPlugin) { self.plugin = plugin }

    func show(_ banner: AMBBanner) {
        if !banners.contains(where: { $0 === banner }) { banners.append(banner) }
        layout()
    }

    func hide(_ banner: AMBBanner) {
        banners.removeAll { $0 === banner }
        layout()
    }

    func reset() {
        banners.removeAll()
        marginTop = 0
        marginBottom = 0
        plugin?.viewController?.setContentInsets(top: 0, bottom: 0)
    }

    func configure(_ ctx: AMBContext) {
        if let color = ctx.optBackgroundColor() { plugin?.viewController?.view.backgroundColor = color }
        if let margin = ctx.optMarginTop(), margin.isFinite { marginTop = max(0, margin) }
        if let margin = ctx.optMarginBottom(), margin.isFinite { marginBottom = max(0, margin) }
        layout()
        ctx.resolve()
    }

    func layout() {
        guard !layingOut, let controller = plugin?.viewController else { return }
        layingOut = true
        defer { layingOut = false }
        if controller.isFullscreenLayout {
            for banner in banners { banner.bannerView?.isHidden = true }
            return
        }
        let root = controller.view!
        let safe = root.safeAreaLayoutGuide.layoutFrame
        let bottom = min(safe.maxY, root.keyboardLayoutGuide.layoutFrame.minY)
        var topHeight: CGFloat = 0
        var bottomHeight: CGFloat = 0
        for banner in banners where banner.visible && banner.isActive && banner.isLoaded() {
            banner.updateSize()
            guard let view = banner.bannerView else { continue }
            if view.superview !== root { root.addSubview(view) }
            view.isHidden = false
            let size = view.adSize.size
            var y: CGFloat
            if let offset = banner.offset {
                y = banner.position == "top" ? offset : root.bounds.height - offset - size.height
            } else if banner.position == "top" {
                if topHeight == 0 { topHeight = marginTop }
                y = safe.minY + topHeight
                topHeight += size.height
            } else {
                if bottomHeight == 0 { bottomHeight = marginBottom }
                bottomHeight += size.height
                y = bottom - bottomHeight
            }
            view.frame = CGRect(x: safe.midX - size.width / 2, y: y, width: size.width, height: size.height)
        }
        controller.setContentInsets(top: topHeight, bottom: bottomHeight)
    }
}

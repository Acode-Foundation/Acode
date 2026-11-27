import GoogleMobileAds
import UIKit

final class AMBBanner: AMBAdBase, BannerViewDelegate, AdSizeDelegate {
    var makeBanner: (AdSize) -> BannerView = { BannerView(adSize: $0) }
    let options: AMBContext
    let position: String
    let offset: CGFloat?
    private(set) var bannerView: BannerView?
    private(set) var visible = false
    private enum LoadState { case idle, loading, loaded }
    private var loadState = LoadState.idle

    override init?(_ ctx: AMBContext) {
        options = ctx
        position = ctx.optPosition()
        offset = ctx.optOffset()
        super.init(ctx)
    }

    override func isLoaded() -> Bool { loadState == .loaded }

    override func load(_ ctx: AMBContext) {
        guard loadState == .idle else { ctx.resolve(); return }
        if bannerView == nil {
            let banner = makeBanner(options.optAdSize())
            banner.delegate = self
            banner.adSizeDelegate = self
            banner.rootViewController = plugin?.viewController
            banner.adUnitID = adUnitId
            banner.paidEventHandler = { [weak self, weak banner] value in
                self?.emitPaid(value, response: banner?.responseInfo)
            }
            bannerView = banner
        }
        loadState = .loading
        bannerView?.load(adRequest)
        ctx.resolve()
    }

    override func show(_ ctx: AMBContext) {
        guard bannerView != nil, isActive else { ctx.resolve(false); return }
        visible = true
        plugin?.banners.show(self)
        ctx.resolve(true)
    }

    override func hide(_ ctx: AMBContext) {
        removeView()
        ctx.resolve()
    }

    override func destroy() {
        removeView()
        bannerView?.delegate = nil
        bannerView?.adSizeDelegate = nil
        bannerView?.paidEventHandler = nil
        bannerView?.rootViewController = nil
        bannerView = nil
        loadState = .idle
        super.destroy()
    }

    func updateSize() {
        guard let bannerView, let size = options.opt("size") as? [String: Any],
              size["adaptive"] != nil, size["width"] == nil else { return }
        let newSize = options.optAdSize()
        if !isAdSizeEqualToSize(size1: bannerView.adSize, size2: newSize) {
            bannerView.adSize = newSize
        }
    }

    func bannerViewDidReceiveAd(_ bannerView: BannerView) {
        guard isActive, self.bannerView === bannerView, loadState != .idle else { return }
        loadState = .loaded
        emit(AMBEvents.adLoad, sizeData(bannerView.adSize))
        emit(AMBEvents.bannerLoad)
        emit(AMBEvents.bannerSize, bannerView.adSize)
        plugin?.banners.layout()
    }

    func bannerView(_ bannerView: BannerView, didFailToReceiveAdWithError error: Error) {
        guard isActive, self.bannerView === bannerView else { return }
        loadState = .idle
        removeView()
        emit(AMBEvents.adLoadFail, error)
    }

    func bannerViewDidRecordImpression(_ bannerView: BannerView) { emit(AMBEvents.adImpression) }
    func bannerViewDidRecordClick(_ bannerView: BannerView) { emit(AMBEvents.adClick) }
    func bannerViewWillPresentScreen(_ bannerView: BannerView) { emit(AMBEvents.adShow) }
    func bannerViewDidDismissScreen(_ bannerView: BannerView) { emit(AMBEvents.adDismiss) }

    func adView(_ bannerView: BannerView, willChangeAdSizeTo size: AdSize) {
        emit(AMBEvents.bannerSize, size)
        emit(AMBEvents.bannerSizeChange, size)
        DispatchQueue.main.async { [weak self] in self?.plugin?.banners.layout() }
    }

    private func removeView() {
        visible = false
        bannerView?.removeFromSuperview()
        plugin?.banners.hide(self)
    }
}

import Foundation
import GoogleMobileAds
import UIKit

protocol AMBNativeAdViewProvider: NSObjectProtocol {
    func createView(_ nativeAd: NativeAd) -> UIView?
    func didShow(_ ad: AMBNativeAd)
    func didHide(_ ad: AMBNativeAd)
}

extension AMBNativeAdViewProvider {
    func didShow(_ ad: AMBNativeAd) {}
    func didHide(_ ad: AMBNativeAd) {}
}

final class AMBNativeAd: AMBAdBase, NativeAdLoaderDelegate, NativeAdDelegate {
    static var providers: [String: AMBNativeAdViewProvider] = ["default": AMNAdViewProvider()]
    private let viewProvider: AMBNativeAdViewProvider
    private var loader: AdLoader?
    private var nativeAd: NativeAd?
    private var loadToken: UUID?
    private var nativeView: UIView?

    override init?(_ ctx: AMBContext) {
        guard let provider = Self.providers[ctx.optString("view", "default")] else { return nil }
        viewProvider = provider
        super.init(ctx)
    }

    override func load(_ ctx: AMBContext) {
        clear()
        loadToken = beginLoad(ctx)
        let loader = AdLoader(adUnitID: adUnitId, rootViewController: plugin?.viewController,
                              adTypes: [.native], options: nil)
        self.loader = loader
        loader.delegate = self
        loader.load(adRequest)
    }

    override func isLoaded() -> Bool { nativeAd != nil }

    override func show(_ ctx: AMBContext) {
        guard let ad = nativeAd, let root = plugin?.viewController?.view,
              let webView = plugin?.webView else { ctx.resolve(false); return }
        if nativeView == nil { nativeView = viewProvider.createView(ad) }
        guard let view = nativeView else { ctx.reject("Native ad view is unavailable"); return }
        if let x = ctx.opt("x") as? Double, let y = ctx.opt("y") as? Double,
           let width = ctx.opt("width") as? Double, let height = ctx.opt("height") as? Double {
            guard x.isFinite, y.isFinite, width.isFinite, height.isFinite, width > 0, height > 0 else {
                ctx.reject("Invalid native ad frame"); return
            }
            let frame = CGRect(x: x, y: y, width: width, height: height)
            view.frame = webView.convert(frame, to: root)
        }
        if view.superview !== root { root.addSubview(view) }
        view.isHidden = false
        viewProvider.didShow(self)
        ctx.resolve(true)
    }

    override func hide(_ ctx: AMBContext) {
        nativeView?.isHidden = true
        viewProvider.didHide(self)
        ctx.resolve()
    }

    override func destroy() {
        clear()
        super.destroy()
    }

    func adLoader(_ adLoader: AdLoader, didReceive nativeAd: NativeAd) {
        guard loader === adLoader, let token = loadToken, acceptsLoad(token) else { return }
        self.nativeAd = nativeAd
        nativeAd.delegate = self
        nativeAd.paidEventHandler = { [weak self, weak nativeAd] value in
            self?.emitPaid(value, response: nativeAd?.responseInfo)
        }
        finishLoad(token)
        loadToken = nil
    }

    func adLoader(_ adLoader: AdLoader, didFailToReceiveAdWithError error: Error) {
        guard loader === adLoader, let token = loadToken else { return }
        finishLoad(token, error: error)
        loadToken = nil
    }

    func nativeAdDidRecordImpression(_ nativeAd: NativeAd) { emit(AMBEvents.adImpression) }
    func nativeAdDidRecordClick(_ nativeAd: NativeAd) { emit(AMBEvents.adClick) }
    func nativeAdWillPresentScreen(_ nativeAd: NativeAd) { emit(AMBEvents.adShow) }
    func nativeAdDidDismissScreen(_ nativeAd: NativeAd) { emit(AMBEvents.adDismiss) }

    private func clear() {
        loader?.delegate = nil
        loader = nil
        nativeAd?.delegate = nil
        nativeAd?.paidEventHandler = nil
        nativeAd = nil
        nativeView?.removeFromSuperview()
        nativeView = nil
        loadToken = nil
    }
}

import GoogleMobileAds
import UIKit

class AMBFullScreen: AMBAdBase, FullScreenContentDelegate {
    private(set) var presenting = false
    override var isPresenting: Bool { presenting }

    func preparePresentation(_ ctx: AMBContext) -> UIViewController? {
        guard isActive, !presenting, let plugin, plugin.presentedAd == nil,
              let controller = plugin.viewController, controller.view.window != nil,
              controller.presentedViewController == nil,
              controller.view.window?.windowScene?.activationState == .foregroundActive else {
            ctx.resolve(false)
            return nil
        }
        presenting = true
        plugin.presentedAd = self
        return controller
    }

    @MainActor
    func recoverPresentation() -> Bool {
        guard isActive, plugin?.canRecoverPresentation == true else { return false }
        // The JS dismissal event may have been lost even when the SDK cleared presenting.
        didFinishPresentation()
        return true
    }

    func clear() {}

    override func destroy() {
        if presenting {
            plugin?.viewController?.dismiss(animated: false)
            presenting = false
            if plugin?.presentedAd === self { plugin?.presentedAd = nil }
        }
        clear()
        super.destroy()
    }

    func adDidRecordImpression(_ ad: FullScreenPresentingAd) { emit(AMBEvents.adImpression) }
    func adDidRecordClick(_ ad: FullScreenPresentingAd) { emit(AMBEvents.adClick) }
    func adWillPresentFullScreenContent(_ ad: FullScreenPresentingAd) { emit(AMBEvents.adShow) }

    func ad(_ ad: FullScreenPresentingAd, didFailToPresentFullScreenContentWithError error: Error) {
        didFinishPresentation()
        emit(AMBEvents.adShowFail, error)
    }

    func adDidDismissFullScreenContent(_ ad: FullScreenPresentingAd) {
        didFinishPresentation()
        emit(AMBEvents.adDismiss)
    }

    private func didFinishPresentation() {
        presenting = false
        if plugin?.presentedAd === self { plugin?.presentedAd = nil }
        clear()
    }
}

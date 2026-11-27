import AppTrackingTransparency
import GoogleMobileAds
import UIKit
import WebKit

final class AMBPlugin: BaseService {
    var ads: [String: AMBAdBase] = [:]
    private(set) var generation = UUID()
    weak var presentedAd: AMBFullScreen?
    private var readyCallback: Callback?
    private var events: [[String: Any]] = []
    private var starting: [AMBContext] = []
    private var started = false
    private var childDirected = false
    private var underAgeOfConsent = false
    @MainActor private lazy var tracking = AMBTrackingAuthorization()
    private(set) var adEnvironment = AMBAdEnvironment(verifiedEnvironment: nil)
    private weak var registeredWebView: WKWebView?
    lazy var banners = AMBBannerLayout(plugin: self)
    lazy var privacy = AMBPrivacy(plugin: self)

    override func exec(action: String, args: [Any], callback: Callback) {
        DispatchQueue.main.async { [self] in
            execute(action, AMBContext(self, args, callback))
        }
    }

    override func reset() {
        DispatchQueue.main.async { [self] in
            clearAds()
            privacy.resetPresentation()
            starting.forEach { $0.reject("Ad initialization was cancelled") }
            starting.removeAll()
            readyCallback?.release()
            readyCallback = nil
            events.removeAll()
            generation = UUID()
            tracking.cancel()
        }
    }

    @MainActor
    func configureAgeTreatment(childDirected: Bool?, underAgeOfConsent: Bool?) {
        guard childDirected != nil || underAgeOfConsent != nil else { return }
        if let childDirected { self.childDirected = childDirected }
        if let underAgeOfConsent { self.underAgeOfConsent = underAgeOfConsent }
        MobileAds.shared.requestConfiguration.ageRestrictedTreatment = self.childDirected || self.underAgeOfConsent ? .child : .unspecified
    }

    @MainActor
    var canRecoverPresentation: Bool {
        guard UIApplication.shared.applicationState == .active,
              let controller = viewController,
              controller.view.window?.windowScene?.activationState == .foregroundActive,
              controller.presentedViewController == nil,
              controller.transitionCoordinator == nil else { return false }
        return true
    }

    @MainActor
    func recoverPresentation(_ id: String) -> Bool {
        guard let ad = ads[id] else { return canRecoverPresentation }
        return (ad as? AMBFullScreen)?.recoverPresentation() ?? false
    }

    func clearAds() {
        for ad in ads.values { ad.destroy() }
        ads.removeAll()
        presentedAd = nil
        banners.reset()
    }

    func emit(_ event: String, data: Any = NSNull()) {
        let payload: [String: Any] = ["type": event, "data": data]
        if let readyCallback { readyCallback.success(payload, keep: true) }
        else if events.count < 100 { events.append(payload) }
    }

    @MainActor
    private func execute(_ action: String, _ ctx: AMBContext) {
        switch action {
        case "ready":
            readyCallback?.release()
            readyCallback = ctx.callback
            for event in events { ctx.callback.success(event, keep: true) }
            events.removeAll()
            emit(AMBEvents.ready, data: ["isRunningInTestLab": false])
        case "configure", "configRequest": ctx.configure()
        case "start": start(ctx)
        case "setAppMuted":
            guard let muted = ctx.opt0() as? Bool else { ctx.reject("Expected a boolean"); return }
            MobileAds.shared.isApplicationMuted = muted
            ctx.resolve()
        case "setAppVolume":
            guard let volume = ctx.opt0() as? Float, volume.isFinite, (0...1).contains(volume) else {
                ctx.reject("Expected a volume from 0 to 1"); return
            }
            MobileAds.shared.applicationVolume = volume
            ctx.resolve()
        case "requestTrackingAuthorization":
            tracking.authorize { result in
                switch result {
                case .success(let status): ctx.resolve(status.rawValue)
                case .failure(let error): ctx.reject(error)
                }
            }
        case "privacyGetState": ctx.resolve(privacy.state)
        case "privacyGatherConsent": privacy.gather(ctx)
        case "privacyShowOptions": privacy.showOptions(ctx)
        case "privacyResetForTesting": privacy.resetForTesting(ctx)
        case "adCreate": create(ctx)
        case "adDestroy":
            guard let id = ctx.optId() else { ctx.reject("id is required"); return }
            ads.removeValue(forKey: id)?.destroy()
            ctx.resolve()
        case "adIsLoaded":
            if let ad = ctx.optAdOrError() { ctx.resolve(ad.isLoaded()) }
        case "adLoad", "adShow":
            guard privacy.canRequestAds else { ctx.reject("Gather ad consent before requesting ads"); return }
            guard started else { ctx.reject("Initialize ads before requesting ads"); return }
            guard let ad = ctx.optAdOrError() else { return }
            if action == "adLoad" { ad.load(ctx) }
            else if ad is AMBBanner || ad.isLoaded() { ad.show(ctx) }
            else { ctx.resolve(false) }
        case "adRecoverPresentation":
            guard let id = ctx.optId() else { ctx.reject("id is required"); return }
            ctx.resolve(recoverPresentation(id))
        case "adHide": ctx.optAdOrError()?.hide(ctx)
        case "bannerConfig": banners.configure(ctx)
        case "webviewGoto":
            // Open the SDK integration page without granting it the app's native bridge.
            guard let text = ctx.opt0() as? String, let url = URL(string: text),
                  ["https", "http"].contains(url.scheme?.lowercased() ?? "") else {
                ctx.reject("Expected an HTTP or HTTPS URL"); return
            }
            let controller = AdsIntegrationViewController(url: url)
            guard let host = viewController, host.presentedViewController == nil else {
                ctx.reject("Another view is already presented"); return
            }
            host.present(controller, animated: true)
            ctx.resolve()
        default: ctx.reject("Unsupported AdMob action: \(action)")
        }
    }

    @MainActor
    private func start(_ ctx: AMBContext) {
        guard privacy.canRequestAds else { ctx.reject("Gather ad consent before requesting ads"); return }
        if started { ctx.resolve(["version": string(for: MobileAds.shared.versionNumber)]); return }
        starting.append(ctx)
        guard starting.count == 1 else { return }
        let token = generation
        tracking.authorize { [weak self] result in
            guard let self, self.generation == token else { return }
            if case .failure(let error) = result {
                let pending = self.starting
                self.starting.removeAll()
                pending.forEach { $0.reject(error) }
                return
            }
            Task { @MainActor [weak self] in
                let environment = await AMBAdEnvironment.current()
                guard let self, self.generation == token else { return }
                guard self.privacy.canRequestAds else {
                    let pending = self.starting
                    self.starting.removeAll()
                    pending.forEach { $0.reject("Gather ad consent before requesting ads") }
                    return
                }
                self.adEnvironment = environment
                self.startSDK(token)
            }
        }
    }

    @MainActor
    private func startSDK(_ token: UUID) {
        let didStart: @MainActor @Sendable () -> Void = { [weak self] in
            guard let self, self.generation == token else { return }
            self.started = true
            if let webView = self.webView, self.registeredWebView !== webView {
                MobileAds.shared.register(webView)
                self.registeredWebView = webView
            }
            let pending = self.starting
            self.starting.removeAll()
            for request in pending { request.resolve(["version": string(for: MobileAds.shared.versionNumber)]) }
        }
        MobileAds.shared.start { _ in
            DispatchQueue.main.async(execute: didStart)
        }
    }

    private func create(_ ctx: AMBContext) {
        guard let id = ctx.optId(), let unit = ctx.optAdUnitID(),
              ctx.optString("cls") == "WebViewAd" || (!id.isEmpty && !unit.isEmpty) else {
            ctx.reject("id and adUnitId are required"); return
        }
        guard ads[id]?.isPresenting != true else { ctx.reject("Ad is presenting"); return }
        let ad: AMBAdBase?
        switch ctx.optString("cls") {
        case "AppOpenAd": ad = AMBAppOpenAd(ctx)
        case "BannerAd": ad = AMBBanner(ctx)
        case "InterstitialAd": ad = AMBInterstitial(ctx)
        case "NativeAd": ad = AMBNativeAd(ctx)
        case "WebViewAd": ad = AMBWebViewAd(ctx)
        case "RewardedAd": ad = AMBRewarded(ctx)
        case "RewardedInterstitialAd": ad = AMBRewardedInterstitial(ctx)
        default: ad = nil
        }
        guard let ad else { ctx.reject("Ad class or options are not supported"); return }
        ads.removeValue(forKey: id)?.destroy()
        ads[id] = ad
        ctx.resolve()
    }
}

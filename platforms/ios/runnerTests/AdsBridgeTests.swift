import GoogleMobileAds
import UserMessagingPlatform
import XCTest
import WebKit
@testable import runner

@MainActor
final class AdsBridgeTests: BridgeTestCase {
    func testFormatsAndConsentGateThroughJavaScriptBridge() async throws {
        let webView = try await appWebView()
        ConsentInformation.shared.reset()
        let result = try await webView.callAsyncJavaScript("""
            const call=(action,args=[])=>new Promise((resolve,reject)=>Bridge.exec(resolve,reject,'AdMob',action,args));
            const state=await call('privacyGetState');
            if(state.canRequestAds||state.consentStatus!=='unknown')throw Error('Consent reset did not take effect');
            for(const cls of ['AppOpenAd','BannerAd','InterstitialAd','NativeAd','RewardedAd','RewardedInterstitialAd']) {
                const id='ios-test-'+cls;
                await call('adCreate',[{id,cls,adUnitId:'ca-app-pub-3940256099942544/4411468910'}]);
                if(await call('adIsLoaded',[{id}]))throw Error(cls+' reports loaded before load');
                try {await call('adLoad',[{id}]);throw Error('Consent bypass');}
                catch(error) {if(!String(error).includes('consent'))throw error;}
                if(cls==='NativeAd'||cls==='BannerAd')await call('adHide',[{id}]);
                await call('adDestroy',[{id}]);await call('adDestroy',[{id}]);
                try {await call('adIsLoaded',[{id}]);throw Error('Destroyed ad still exists');}
                catch(error) {if(!String(error).includes('not found'))throw error;}
            }
            try {await admob.start();throw Error('Started before consent');}
            catch(error) {if(!String(error).includes('consent'))throw error;}
            return true;
            """, arguments: [:], in: nil, contentWorld: .page) as? Bool
        XCTAssertEqual(result, true)
    }

    func testDestroyAndReplacementInvalidatePendingLoadsAndEvents() async throws {
        let (controller, plugin) = try await host()
        let webView = controller.webView!
        _ = try await webView.evaluateJavaScript("window.iosAdEvents=[];window.iosAdListener=e=>iosAdEvents.push(e.adId);document.addEventListener('admob.ad.load',iosAdListener)")
        defer {
            plugin.ads.removeValue(forKey: "lifecycle")?.destroy()
            webView.evaluateJavaScript("document.removeEventListener('admob.ad.load',iosAdListener);delete window.iosAdEvents;delete window.iosAdListener")
        }
        let original = try XCTUnwrap(AMBAdBase(context(plugin, id: "lifecycle")))
        plugin.ads[original.id] = original
        let pending = original.beginLoad(context(plugin, id: original.id))
        original.destroy()
        let replacement = try XCTUnwrap(AMBAdBase(context(plugin, id: original.id)))
        plugin.ads[replacement.id] = replacement
        original.finishLoad(pending)
        XCTAssertFalse(original.acceptsLoad(pending))
        XCTAssertTrue(plugin.ads[original.id] === replacement)
        let stale = replacement.beginLoad(context(plugin, id: replacement.id))
        let current = replacement.beginLoad(context(plugin, id: replacement.id))
        XCTAssertFalse(replacement.acceptsLoad(stale))
        replacement.finishLoad(stale)
        replacement.finishLoad(current)
        try await Task.sleep(for: .milliseconds(100))
        let events = try await webView.evaluateJavaScript("iosAdEvents") as? [String]
        XCTAssertEqual(events, ["lifecycle"])
        let beforeReload = context(plugin, id: "reload")
        plugin.reset()
        try await Task.sleep(for: .milliseconds(100))
        XCTAssertFalse(beforeReload.isCurrent)
        XCTAssertTrue(replacement.destroyed)
        XCTAssertTrue(plugin.ads.isEmpty)
        _ = try await webView.evaluateJavaScript("Bridge.exec(e=>{const d=e.data;if(d?.adId)d.ad=window.admobAds?.[d.adId];Bridge.fireDocumentEvent(e.type,d)},console.error,'AdMob','ready',[])")
    }

    func testAdRequestsUseThePresentingWindowScene() async throws {
        let (controller, plugin) = try await host()
        let scene = try XCTUnwrap(controller.view.window?.windowScene)
        let webView = controller.webView!
        let classes = ["AppOpenAd", "BannerAd", "InterstitialAd", "NativeAd", "RewardedAd", "RewardedInterstitialAd"]
        defer { for name in classes { plugin.ads.removeValue(forKey: "scene-" + name)?.destroy() } }
        _ = try await webView.callAsyncJavaScript("""
            for(const cls of classes) {
                await new Promise((resolve,reject)=>Bridge.exec(resolve,reject,'AdMob','adCreate',[{
                    id:'scene-'+cls,cls,adUnitId:'ca-app-pub-3940256099942544/4411468910'
                }]));
            }
            """, arguments: ["classes": classes], in: nil, contentWorld: .page)
        for name in classes {
            let ad = try XCTUnwrap(plugin.ads["scene-" + name])
            XCTAssertTrue(ad.adRequest.scene === scene, "\(name) must request an ad sized for the presenting window")
        }
    }

    func testBannersReserveSpaceStackHideAndRestoreEditorAfterDestroy() async throws {
        let (controller, plugin) = try await host()
        controller.view.layoutIfNeeded()
        let initial = controller.webView.frame.height
        let top = try banner(plugin, id: "top", position: "top")
        let bottom = try banner(plugin, id: "bottom", position: "bottom")
        defer {
            for ad in [top, bottom] { plugin.ads.removeValue(forKey: ad.id)?.destroy() }
        }
        top.show(context(plugin, id: top.id))
        bottom.show(context(plugin, id: bottom.id))
        XCTAssertEqual(controller.webView.frame.height, initial - 100, accuracy: 1)
        let topView = try XCTUnwrap(top.bannerView)
        let bottomView = try XCTUnwrap(bottom.bannerView)
        XCTAssertLessThan(topView.frame.minY, bottomView.frame.minY)
        top.show(context(plugin, id: top.id))
        XCTAssertEqual(controller.webView.frame.height, initial - 100, accuracy: 1)
        top.hide(context(plugin, id: top.id))
        XCTAssertEqual(controller.webView.frame.height, initial - 50, accuracy: 1)
        bottom.destroy()
        XCTAssertNil(bottomView.superview)
        XCTAssertEqual(controller.webView.frame.height, initial, accuracy: 1)
        XCTAssertNil(bottomView.delegate)
    }

    func testNativeTemplateLoadsAndFullscreenAdsCannotCompete() async throws {
        let (controller, plugin) = try await host()
        XCTAssertNotNil(AMNAdViewProvider().createView(NativeAd()))
        let first = try XCTUnwrap(AMBFullScreen(context(plugin, id: "fullscreen-1")))
        let second = try XCTUnwrap(AMBFullScreen(context(plugin, id: "fullscreen-2")))
        plugin.ads[first.id] = first
        plugin.ads[second.id] = second
        defer { for ad in [first, second] { plugin.ads.removeValue(forKey: ad.id)?.destroy() } }
        XCTAssertTrue(first.preparePresentation(context(plugin, id: first.id)) === controller)
        XCTAssertNil(second.preparePresentation(context(plugin, id: second.id)))
        first.destroy()
        XCTAssertTrue(second.preparePresentation(context(plugin, id: second.id)) === controller)
    }

    func testPresentationRecoveryNeverDismissesAVisibleController() async throws {
        let (controller, plugin) = try await host()
        let ad = try XCTUnwrap(AMBFullScreen(context(plugin, id: "recovery")))
        plugin.ads[ad.id] = ad
        defer { plugin.ads.removeValue(forKey: ad.id)?.destroy() }
        XCTAssertNotNil(ad.preparePresentation(context(plugin, id: ad.id)))
        let visible = UIViewController()
        await withCheckedContinuation { continuation in
            controller.present(visible, animated: false) { continuation.resume() }
        }
        XCTAssertFalse(ad.recoverPresentation())
        XCTAssertFalse(plugin.recoverPresentation("already-removed"))
        XCTAssertTrue(ad.isPresenting)
        XCTAssertTrue(controller.presentedViewController === visible)
        await withCheckedContinuation { continuation in
            visible.dismiss(animated: false) { continuation.resume() }
        }
        XCTAssertTrue(ad.recoverPresentation())
        XCTAssertFalse(ad.isPresenting)
        XCTAssertNil(plugin.presentedAd)
        // Recovery also handles the case where only the JS event was lost.
        XCTAssertTrue(ad.recoverPresentation())
        ad.destroy()
        XCTAssertFalse(ad.recoverPresentation())
        plugin.ads.removeValue(forKey: ad.id)
        XCTAssertTrue(plugin.recoverPresentation(ad.id))
    }

    func testPaidImpressionPayloadPreservesFormatsAndCurrencyMicros() async throws {
        let (controller, plugin) = try await host()
        let webView = controller.webView!
        _ = try await webView.evaluateJavaScript("window.iosPaidEvents=[];window.iosPaidListener=e=>iosPaidEvents.push({adId:e.adId,adFormat:e.adFormat,valueMicros:e.valueMicros,currencyCode:e.currencyCode,precision:e.precision});document.addEventListener('admob.ad.paid',iosPaidListener)")
        defer { webView.evaluateJavaScript("document.removeEventListener('admob.ad.paid',iosPaidListener);delete window.iosPaidEvents;delete window.iosPaidListener") }
        let formats = ["AppOpenAd": "appOpen", "BannerAd": "banner", "InterstitialAd": "interstitial",
                       "NativeAd": "native", "RewardedAd": "rewarded", "RewardedInterstitialAd": "rewardedInterstitial"]
        for (name, _) in formats {
            let ad = try XCTUnwrap(AMBAdBase(context(plugin, id: name, options: ["cls": name])))
            plugin.ads[ad.id] = ad
            ad.emitPaid(FixtureAdValue(), response: nil)
            plugin.ads.removeValue(forKey: ad.id)?.destroy()
        }
        try await Task.sleep(for: .milliseconds(100))
        let payload = try await webView.evaluateJavaScript("iosPaidEvents")
        let values = try XCTUnwrap(payload as? [[String: Any]])
        XCTAssertEqual(values.count, formats.count)
        for value in values {
            XCTAssertEqual(value["adFormat"] as? String, formats[value["adId"] as? String ?? ""])
            XCTAssertEqual(value["valueMicros"] as? Int, 123456)
            XCTAssertEqual(value["currencyCode"] as? String, "USD")
            XCTAssertEqual(value["precision"] as? Int, 3)
        }
    }

    func host() async throws -> (WebViewController, AMBPlugin) {
        let webView = try await appWebView()
        var responder: UIResponder? = webView
        while responder != nil, !(responder is WebViewController) { responder = responder?.next }
        let controller = try XCTUnwrap(responder as? WebViewController)
        return (controller, try XCTUnwrap(controller.bridge.adsService))
    }

    func context(_ plugin: AMBPlugin, id: String, options: [String: Any] = [:]) -> AMBContext {
        var args: [String: Any] = ["id": id, "adUnitId": "ca-app-pub-3940256099942544/2934735716", "cls": "BannerAd"]
        args.merge(options) { _, new in new }
        return AMBContext(plugin, [args], Callback(id: 0, webView: nil))
    }

    func banner(_ plugin: AMBPlugin, id: String, position: String, loaded: Bool = true) throws -> AMBBanner {
        let ctx = context(plugin, id: id, options: ["position": position, "size": 0])
        let ad = try XCTUnwrap(AMBBanner(ctx))
        ad.makeBanner = { OfflineBanner(adSize: $0) }
        plugin.ads[id] = ad
        ad.load(ctx)
        if loaded { ad.bannerViewDidReceiveAd(try XCTUnwrap(ad.bannerView)) }
        return ad
    }
}

private final class FixtureAdValue: AdValue {
    override var value: NSDecimalNumber { NSDecimalNumber(string: "0.123456") }
    override var currencyCode: String { "USD" }
    override var precision: AdValuePrecision { .precise }
}

private final class OfflineBanner: BannerView {
    override func load(_ request: Request?) {}
}

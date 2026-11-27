import GoogleMobileAds
import XCTest
@testable import runner

extension AdsBridgeTests {
    func testBannerReservesSpaceOnlyAfterLoadAndClearsItOnFailure() async throws {
        let (controller, plugin) = try await host()
        controller.view.layoutIfNeeded()
        let initial = controller.webView.frame.height
        let ad = try banner(plugin, id: "pending-banner", position: "bottom", loaded: false)
        let view = try XCTUnwrap(ad.bannerView)
        defer { plugin.ads.removeValue(forKey: ad.id)?.destroy() }

        ad.show(context(plugin, id: ad.id))
        XCTAssertFalse(ad.isLoaded())
        XCTAssertNil(view.superview)
        XCTAssertEqual(controller.webView.frame.height, initial, accuracy: 1)

        ad.bannerViewDidReceiveAd(view)
        XCTAssertTrue(ad.isLoaded())
        XCTAssertNotNil(view.superview)
        XCTAssertEqual(controller.webView.frame.height, initial - 50, accuracy: 1)

        ad.bannerView(view, didFailToReceiveAdWithError: NSError(domain: "AdMob", code: 1))
        XCTAssertFalse(ad.isLoaded())
        XCTAssertNil(view.superview)
        XCTAssertEqual(controller.webView.frame.height, initial, accuracy: 1)

        ad.bannerViewDidReceiveAd(view)
        XCTAssertFalse(ad.isLoaded())
        XCTAssertNil(view.superview)
        XCTAssertEqual(controller.webView.frame.height, initial, accuracy: 1)

        ad.load(context(plugin, id: ad.id))
        ad.show(context(plugin, id: ad.id))
        XCTAssertEqual(controller.webView.frame.height, initial, accuracy: 1)
        ad.bannerViewDidReceiveAd(view)
        XCTAssertEqual(controller.webView.frame.height, initial - 50, accuracy: 1)
    }

    func testHidingPendingBannerPreventsLateLoadFromRestoringSpace() async throws {
        let (controller, plugin) = try await host()
        controller.view.layoutIfNeeded()
        let initial = controller.webView.frame.height
        let ad = try banner(plugin, id: "hidden-banner", position: "bottom", loaded: false)
        let view = try XCTUnwrap(ad.bannerView)
        defer { plugin.ads.removeValue(forKey: ad.id)?.destroy() }

        ad.show(context(plugin, id: ad.id))
        ad.hide(context(plugin, id: ad.id))
        ad.bannerViewDidReceiveAd(view)
        plugin.banners.layout()
        XCTAssertTrue(ad.isLoaded())
        XCTAssertFalse(ad.visible)
        XCTAssertNil(view.superview)
        XCTAssertEqual(controller.webView.frame.height, initial, accuracy: 1)

        ad.show(context(plugin, id: ad.id))
        XCTAssertEqual(controller.webView.frame.height, initial - 50, accuracy: 1)
        ad.hide(context(plugin, id: ad.id))
        XCTAssertEqual(controller.webView.frame.height, initial, accuracy: 1)
    }

    func testDestroyedBannerIgnoresLateLoadAndFailureCallbacks() async throws {
        let (controller, plugin) = try await host()
        controller.view.layoutIfNeeded()
        let initial = controller.webView.frame.height
        let ad = try banner(plugin, id: "destroyed-banner", position: "bottom", loaded: false)
        let view = try XCTUnwrap(ad.bannerView)
        ad.show(context(plugin, id: ad.id))
        plugin.ads.removeValue(forKey: ad.id)?.destroy()

        ad.bannerViewDidReceiveAd(view)
        ad.bannerView(view, didFailToReceiveAdWithError: NSError(domain: "AdMob", code: 1))
        plugin.banners.layout()
        XCTAssertFalse(ad.isLoaded())
        XCTAssertNil(view.superview)
        XCTAssertEqual(controller.webView.frame.height, initial, accuracy: 1)
    }
}

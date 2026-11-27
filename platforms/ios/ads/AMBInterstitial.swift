import GoogleMobileAds

class AMBInterstitial: AMBFullScreen {
    var mAd: InterstitialAd?

    override func isLoaded() -> Bool {
        return self.mAd != nil && !presenting
    }

    override func load(_ ctx: AMBContext) {
        guard !presenting else { ctx.reject("Ad is presenting"); return }
        clear()
        let token = beginLoad(ctx)

        InterstitialAd.load(
            with: adUnitId,
            request: adRequest,
            completionHandler: { [weak self] ad, error in
                guard let self, self.acceptsLoad(token) else { return }
                if let error {
                    self.finishLoad(token, error: error)
                    return
                }

                self.mAd = ad
                ad?.fullScreenContentDelegate = self
                ad?.paidEventHandler = { [weak self, weak ad] value in self?.emitPaid(value, response: ad?.responseInfo) }

                self.finishLoad(token)
         })
    }

    override func show(_ ctx: AMBContext) {
        guard let ad = mAd, let controller = preparePresentation(ctx) else { return }
        ad.present(from: controller)
        ctx.resolve(true)
    }

    override func clear() {
        mAd?.fullScreenContentDelegate = nil
        mAd?.paidEventHandler = nil
        mAd = nil
    }
}

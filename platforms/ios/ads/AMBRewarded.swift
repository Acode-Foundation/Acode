import GoogleMobileAds

class AMBRewarded: AMBFullScreen {
    var mAd: RewardedAd?

    override func isLoaded() -> Bool {
        return self.mAd != nil && !presenting
    }

    override func load(_ ctx: AMBContext) {
        guard !presenting else { ctx.reject("Ad is presenting"); return }
        clear()
        let token = beginLoad(ctx)

        RewardedAd.load(with: adUnitId, request: adRequest, completionHandler: { [weak self] ad, error in
            guard let self, self.acceptsLoad(token) else { return }
            if let error {
                self.finishLoad(token, error: error)

                return
            }

            self.mAd = ad
            ad?.fullScreenContentDelegate = self
            ad?.paidEventHandler = { [weak self, weak ad] value in self?.emitPaid(value, response: ad?.responseInfo) }
            ad?.serverSideVerificationOptions = ctx.optGADServerSideVerificationOptions()

            self.finishLoad(token)
        })
    }

    override func show(_ ctx: AMBContext) {
        guard let ad = mAd, let controller = preparePresentation(ctx) else { return }
        let reward = ad.adReward
        ad.present(from: controller, userDidEarnRewardHandler: { [weak self] in
            self?.emit(AMBEvents.adReward, reward)
        })
        ctx.resolve(true)
    }

    override func clear() {
        mAd?.fullScreenContentDelegate = nil
        mAd?.paidEventHandler = nil
        mAd = nil
    }
}

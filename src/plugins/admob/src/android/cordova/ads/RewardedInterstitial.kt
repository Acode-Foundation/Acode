package admob.plus.cordova.ads

import admob.plus.cordova.Events
import admob.plus.cordova.ExecuteContext
import com.google.android.gms.ads.AdError
import com.google.android.gms.ads.FullScreenContentCallback
import com.google.android.gms.ads.LoadAdError
import com.google.android.gms.ads.rewarded.RewardItem
import com.google.android.gms.ads.rewardedinterstitial.RewardedInterstitialAd
import com.google.android.gms.ads.rewardedinterstitial.RewardedInterstitialAdLoadCallback

class RewardedInterstitial(ctx: ExecuteContext) : AdBase(ctx) {
    private var mAd: RewardedInterstitialAd? = null
    override fun onDestroy() {
        clear()
        super.onDestroy()
    }

    override fun load(ctx: ExecuteContext) {
        clear()
        RewardedInterstitialAd.load(
            plugin.activity,
            adUnitId,
            adRequest,
            object : RewardedInterstitialAdLoadCallback() {
                override fun onAdFailedToLoad(loadAdError: LoadAdError) {
                    mAd = null
                    emit(Events.AD_LOAD_FAIL, loadAdError)
                    ctx.reject(loadAdError.toString())
                }

                override fun onAdLoaded(rewardedAd: RewardedInterstitialAd) {
                    mAd = rewardedAd
                    val ssv = buildServerSideVerificationOptions(initOpts)
                    if (ssv != null) {
                        mAd!!.setServerSideVerificationOptions(ssv)
                    }
                    mAd!!.fullScreenContentCallback = object : FullScreenContentCallback() {
                        override fun onAdDismissedFullScreenContent() {
                            emit(Events.AD_DISMISS)
                        }

                        override fun onAdFailedToShowFullScreenContent(adError: AdError) {
                            emit(Events.AD_SHOW_FAIL, adError)
                        }

                        override fun onAdShowedFullScreenContent() {
                            mAd = null
                            emit(Events.AD_SHOW)
                        }

                        override fun onAdImpression() {
                            emit(Events.AD_IMPRESSION)
                        }
                    }
                    emit(Events.AD_LOAD)
                    ctx.resolve()
                }
            })
    }

    override val isLoaded: Boolean
        get() = mAd != null

    override fun show(ctx: ExecuteContext) {
        if (this.isLoaded) {
            mAd!!.show(plugin.activity) { rewardItem: RewardItem? ->
                emit(Events.AD_REWARD, rewardItem!!)
            }
            ctx.resolve()
        } else {
            ctx.reject("Ad is not loaded")
        }
    }

    private fun clear() {
        if (mAd != null) {
            mAd = null
        }
    }
}

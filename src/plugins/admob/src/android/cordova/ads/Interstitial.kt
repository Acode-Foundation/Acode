package admob.plus.cordova.ads

import admob.plus.cordova.Events
import admob.plus.cordova.ExecuteContext
import com.google.android.gms.ads.AdError
import com.google.android.gms.ads.LoadAdError
import com.google.android.gms.ads.interstitial.InterstitialAd
import com.google.android.gms.ads.interstitial.InterstitialAdLoadCallback
import com.google.android.gms.ads.FullScreenContentCallback

class Interstitial(ctx: ExecuteContext) : AdBase(ctx) {
    private var mAd: InterstitialAd? = null

    override val isLoaded get() = mAd != null

    override fun onDestroy() {
        clear()
        super.onDestroy()
    }

    override fun load(ctx: ExecuteContext) {
        clear()
        InterstitialAd.load(ctx.activity, adUnitId, adRequest, object : InterstitialAdLoadCallback() {
            override fun onAdLoaded(interstitialAd: InterstitialAd) {
                mAd = interstitialAd
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

            override fun onAdFailedToLoad(loadAdError: LoadAdError) {
                mAd = null
                emit(Events.AD_LOAD_FAIL, loadAdError)
                ctx.reject(loadAdError.toString())
            }
        })
    }

    override fun show(ctx: ExecuteContext) {
        if (isLoaded) {
            mAd!!.show(ctx.activity)
            ctx.resolve()
        } else {
            ctx.reject("Ad is not loaded")
        }
    }

    private fun clear() {
        mAd?.let {
            it.fullScreenContentCallback = null
            mAd = null
        }
    }
}

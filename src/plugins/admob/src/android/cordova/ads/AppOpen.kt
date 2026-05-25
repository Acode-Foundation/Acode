package admob.plus.cordova.ads

import admob.plus.cordova.Events
import admob.plus.cordova.ExecuteContext
import admob.plus.core.buildAdRequest
import com.google.android.gms.ads.AdError
import com.google.android.gms.ads.AdRequest
import com.google.android.gms.ads.FullScreenContentCallback
import com.google.android.gms.ads.LoadAdError
import com.google.android.gms.ads.appopen.AppOpenAd
import com.google.android.gms.ads.appopen.AppOpenAd.AppOpenAdLoadCallback

class AppOpen(ctx: ExecuteContext) : AdBase(ctx) {
    private val mAdRequest: AdRequest = buildAdRequest(initOpts)
    private var mAd: AppOpenAd? = null

    override fun onDestroy() {
        clear()
        super.onDestroy()
    }

    override fun load(ctx: ExecuteContext) {
        clear()
        AppOpenAd.load(plugin.activity,
            adUnitId,
            mAdRequest,
            object : AppOpenAdLoadCallback() {
                override fun onAdLoaded(ad: AppOpenAd) {
                    mAd = ad
                    ad.fullScreenContentCallback = object : FullScreenContentCallback() {
                        override fun onAdDismissedFullScreenContent() {
                            clear()
                            emit(Events.AD_DISMISS)
                        }

                        override fun onAdFailedToShowFullScreenContent(adError: AdError) {
                            clear()
                            emit(Events.AD_SHOW_FAIL, adError)
                        }

                        override fun onAdShowedFullScreenContent() {
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
                    clear()
                    emit(Events.AD_LOAD_FAIL, loadAdError)
                    ctx.reject(loadAdError.toString())
                }
            })
    }

    override val isLoaded: Boolean get() = mAd != null

    override fun show(ctx: ExecuteContext) {
        mAd?.show(plugin.activity)
        ctx.resolve(true)
    }

    private fun clear() {
        if (mAd != null) {
            mAd = null
        }
    }
}

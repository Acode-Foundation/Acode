package admob.plus.cordova.ads

import admob.plus.cordova.Events
import admob.plus.cordova.ExecuteContext
import admob.plus.core.buildAdRequest
import admob.plus.core.dpToPx
import android.util.Log
import android.view.View
import android.view.ViewGroup
import com.google.android.gms.ads.AdListener
import com.google.android.gms.ads.AdLoader
import com.google.android.gms.ads.AdRequest
import com.google.android.gms.ads.LoadAdError
import com.google.android.gms.ads.nativead.NativeAd
import com.google.android.gms.ads.nativead.NativeAdOptions
import com.google.android.gms.ads.nativead.NativeAdView
import java.util.Objects
import java.util.concurrent.ConcurrentHashMap

class Native(ctx: ExecuteContext) : AdBase(ctx) {
    private val mAdRequest: AdRequest = buildAdRequest(initOpts)
    private val viewProvider: ViewProvider
    private var mLoader: AdLoader? = null
    private var mAd: NativeAd? = null
    private var view: View? = null

    init {
        val key = initOpts.optString("view").ifEmpty { VIEW_DEFAULT_KEY }
        viewProvider = providers[key] ?: throw RuntimeException("cannot find viewProvider: $key")
    }

    override fun onDestroy() {
        clear()
        super.onDestroy()
    }

    override val isLoaded: Boolean get() = mLoader != null && !mLoader!!.isLoading

    override fun load(ctx: ExecuteContext) {
        clear()
        mLoader = AdLoader.Builder(plugin.activity, adUnitId)
            .forNativeAd { nativeAd -> mAd = nativeAd }
            .withAdListener(object : AdListener() {
                override fun onAdFailedToLoad(adError: LoadAdError) {
                    emit(Events.AD_LOAD_FAIL, adError)
                    if (isLoaded) {
                        ctx.reject(adError.toString())
                    }
                }

                override fun onAdClosed() {
                    emit(Events.AD_DISMISS)
                }

                override fun onAdOpened() {
                    emit(Events.AD_SHOW)
                }

                override fun onAdLoaded() {
                    emit(Events.AD_LOAD)
                    if (isLoaded) {
                        ctx.resolve()
                    }
                }

                override fun onAdClicked() {
                    emit(Events.AD_CLICK)
                }

                override fun onAdImpression() {
                    emit(Events.AD_IMPRESSION)
                }
            })
            .withNativeAdOptions(
                NativeAdOptions.Builder()
                    .build()
            )
            .build().also {
                it.loadAd(mAdRequest)
            }
    }

    override fun show(ctx: ExecuteContext) {
        val ad = mAd ?: return ctx.reject("ad not loaded")
        view = view ?: let {
            val v = viewProvider.createView(ad)
            Objects.requireNonNull<ViewGroup>(plugin.contentView).addView(v)
            v
        }
        view?.let {
            it.visibility = View.VISIBLE
            it.x = dpToPx(ctx.opts.optDouble("x", 0.0)).toFloat()
            it.y = dpToPx(ctx.opts.optDouble("y", 0.0)).toFloat()

            val params = it.layoutParams
            params.width = dpToPx(ctx.opts.optDouble("width", 0.0)).toInt()
            params.height = dpToPx(ctx.opts.optDouble("height", 0.0)).toInt()
            it.layoutParams = params

            viewProvider.didShow(this)
            it.requestLayout()
        }
        ctx.resolve(true)
    }

    override fun hide(ctx: ExecuteContext) {
        view?.let {
            it.visibility = View.GONE
        }
        viewProvider.didHide(this)
        ctx.resolve()
    }

    private fun clear() {
        mAd?.let {
            it.destroy()
            mAd = null
        }
        view?.let {
            when (it) {
                is NativeAdView -> {
                    it.removeAllViews()
                    it.destroy()
                }
            }
            view = null
        }
        mLoader = null
    }

    interface ViewProvider {
        fun createView(nativeAd: NativeAd): View

        fun didShow(ad: Native) {
            Log.d(TAG, "Show Ad: ${ad.id}")
        }

        fun didHide(ad: Native) {
            Log.d(TAG, "Hide Ad: ${ad.id}")
        }
    }

    companion object {
        private const val TAG = "AdMobPlus.Native"

        const val VIEW_DEFAULT_KEY = "default"
        val providers = ConcurrentHashMap<String, ViewProvider>()
    }
}

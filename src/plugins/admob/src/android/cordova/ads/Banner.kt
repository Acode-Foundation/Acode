package admob.plus.cordova.ads

import admob.plus.cordova.Events
import admob.plus.cordova.ExecuteContext
import admob.plus.core.buildAdSize
import admob.plus.core.pxToDp
import android.annotation.SuppressLint
import android.content.res.Configuration
import android.util.Log
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.RelativeLayout
import com.google.android.gms.ads.AdListener
import com.google.android.gms.ads.AdSize
import com.google.android.gms.ads.AdView
import com.google.android.gms.ads.LoadAdError
import org.json.JSONObject

enum class AdSizeType {
    BANNER, LARGE_BANNER, MEDIUM_RECTANGLE, FULL_BANNER, LEADERBOARD, SMART_BANNER;

    companion object {
        fun getAdSize(adSize: Int): AdSize? {
            return when (values()[adSize]) {
                BANNER -> AdSize.BANNER
                LARGE_BANNER -> AdSize.LARGE_BANNER
                MEDIUM_RECTANGLE -> AdSize.MEDIUM_RECTANGLE
                FULL_BANNER -> AdSize.FULL_BANNER
                LEADERBOARD -> AdSize.LEADERBOARD
                SMART_BANNER -> AdSize.SMART_BANNER
                else -> null
            }
        }
    }
}

fun buildGravity(opts: JSONObject): Int {
    return if ("top" == opts.optString("position")) Gravity.TOP else Gravity.BOTTOM
}

fun buildOffset(opts: JSONObject): Int? {
    return if (opts.has("offset")) {
        opts.optInt("offset")
    } else null
}

class Banner(ctx: ExecuteContext) : AdBase(ctx) {
    private val adSize: AdSize
    private val gravity: Int
    private val offset: Int?
    private var mAdView: AdView? = null
    private var mRelativeLayout: RelativeLayout? = null
    private var mAdViewOld: AdView? = null

    override val isLoaded: Boolean
        get() = mAdView != null

    init {
        adSize = buildAdSize(initOpts, ctx.activity)
        gravity = buildGravity(initOpts)
        offset = buildOffset(initOpts)
    }

    override fun load(ctx: ExecuteContext) {
        if (mAdView == null) {
            mAdView = createBannerView()
        }
        mAdView!!.loadAd(adRequest)
        ctx.resolve()
    }

    private fun createBannerView(): AdView {
        val adView = AdView(plugin.activity)
        adView.adUnitId = adUnitId
        adView.setAdSize(adSize)
        adView.adListener = object : AdListener() {
            override fun onAdClicked() {
                emit(Events.AD_CLICK)
            }

            override fun onAdClosed() {
                emit(Events.AD_DISMISS)
            }

            override fun onAdFailedToLoad(error: LoadAdError) {
                emit(Events.AD_LOAD_FAIL, error)
            }

            override fun onAdImpression() {
                emit(Events.AD_IMPRESSION)
            }

            override fun onAdLoaded() {
                if (mAdViewOld != null) {
                    removeBannerView(mAdViewOld!!)
                    mAdViewOld = null
                }
                runJustBeforeBeingDrawn(adView) {
                    emit(Events.BANNER_SIZE, computeAdSize())
                }
                emit(Events.AD_LOAD, computeAdSize())
            }

            override fun onAdOpened() {
                emit(Events.AD_SHOW)
            }
        }
        return adView
    }

    private fun computeAdSize(): Map<String, Any> {
        val width = mAdView!!.width
        val height = mAdView!!.height
        return mapOf(
            "size" to mapOf(
                "width" to pxToDp(width),
                "height" to pxToDp(height),
                "widthInPixels" to width,
                "heightInPixels" to height,
            )
        )
    }

    override fun show(ctx: ExecuteContext) {
        if (mAdView!!.parent == null) {
            addBannerView()
        } else if (mAdView!!.visibility == View.GONE) {
            mAdView!!.resume()
            mAdView!!.visibility = View.VISIBLE
        } else {
            val wvParentView = getParentView(webView)
            if (rootLinearLayout !== wvParentView && webViewWrapper !== wvParentView) {
                removeFromParentView(rootLinearLayout)
                addBannerView()
            }
        }
        ctx.resolve()
    }

    override fun hide(ctx: ExecuteContext) {
        if (mAdView != null) {
            mAdView!!.pause()
            mAdView!!.visibility = View.GONE
        }
        ctx.resolve()
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        val w = plugin.activity.resources.displayMetrics.widthPixels
        if (w != screenWidth) {
            screenWidth = w
            plugin.activity.runOnUiThread { reloadBannerView() }
        }
    }

    private fun reloadBannerView() {
        if (mAdView == null || mAdView!!.visibility == View.GONE) return
        pauseBannerViews()
        if (mAdViewOld != null) removeBannerView(mAdViewOld!!)
        mAdViewOld = mAdView
        mAdView = createBannerView()
        mAdView!!.loadAd(adRequest)
        addBannerView()
    }

    override fun onPause(multitasking: Boolean) {
        pauseBannerViews()
        super.onPause(multitasking)
    }

    private fun pauseBannerViews() {
        if (mAdView != null) mAdView!!.pause()
        if (mAdViewOld != null && mAdViewOld != mAdView) {
            mAdViewOld!!.pause()
        }
    }

    override fun onResume(multitasking: Boolean) {
        super.onResume(multitasking)
        resumeBannerViews()
    }

    private fun resumeBannerViews() {
        if (mAdView != null) mAdView!!.resume()
        if (mAdViewOld != null) mAdViewOld!!.resume()
    }

    override fun onDestroy() {
        if (mAdView != null) {
            removeBannerView(mAdView!!)
            mAdView = null
        }
        if (mAdViewOld != null) {
            removeBannerView(mAdViewOld!!)
            mAdViewOld = null
        }
        if (mRelativeLayout != null) {
            removeFromParentView(mRelativeLayout)
            mRelativeLayout = null
        }
        super.onDestroy()
    }

    private fun removeBannerView(adView: AdView) {
        removeFromParentView(adView)
        adView.removeAllViews()
        adView.destroy()
    }

    private fun addBannerView() {
        if (mAdView == null) return
        if (offset == null) {
            if (getParentView(mAdView) === rootLinearLayout && rootLinearLayout != null) return
            addBannerViewWithLinearLayout()
        } else {
            if (getParentView(mAdView) === mRelativeLayout && mRelativeLayout != null) return
            addBannerViewWithRelativeLayout()
        }
        plugin.contentView?.let {
            it.bringToFront()
            it.requestLayout()
            it.requestFocus()
        }
    }

    private fun addBannerViewWithLinearLayout() {
        val wvParentView = getParentView(webView)
        if (rootLinearLayout == null) {
            rootLinearLayout = LinearLayout(plugin.activity)
        }
        if (wvParentView != null && wvParentView !== rootLinearLayout && wvParentView !== webViewWrapper) {
            if (webViewWrapper == null) {
                webViewWrapper = FrameLayout(plugin.activity)
            } else {
                removeFromParentView(webViewWrapper)
            }
            wvParentView.removeView(webView)
            val content = rootLinearLayout as LinearLayout?
            content!!.orientation = LinearLayout.VERTICAL
            rootLinearLayout!!.layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
                0.0f
            )
            webViewWrapper!!.layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
                1.0f
            )
            webViewWrapper!!.addView(webView)
            rootLinearLayout!!.addView(webViewWrapper)
            val view = getParentView(rootLinearLayout)
            if (view !== wvParentView) {
                removeFromParentView(rootLinearLayout)
                wvParentView.addView(rootLinearLayout)
            }
        }
        removeFromParentView(mAdView)
        if (isPositionTop) {
            rootLinearLayout!!.addView(mAdView, 0)
        } else {
            rootLinearLayout!!.addView(mAdView)
        }
        plugin.contentView?.let {
            for (i in 0 until it.childCount) {
                val view = it.getChildAt(i)
                (view as? RelativeLayout)?.bringToFront()
            }
        }
    }

    private fun addBannerViewWithRelativeLayout() {
        val paramsContent = RelativeLayout.LayoutParams(
            RelativeLayout.LayoutParams.MATCH_PARENT,
            RelativeLayout.LayoutParams.WRAP_CONTENT
        )
        paramsContent.addRule(if (isPositionTop) RelativeLayout.ALIGN_PARENT_TOP else RelativeLayout.ALIGN_PARENT_BOTTOM)
        if (mRelativeLayout == null) {
            mRelativeLayout = RelativeLayout(plugin.activity)
            val params = RelativeLayout.LayoutParams(
                RelativeLayout.LayoutParams.MATCH_PARENT,
                RelativeLayout.LayoutParams.MATCH_PARENT
            )
            if (isPositionTop) {
                params.setMargins(0, offset!!, 0, 0)
            } else {
                params.setMargins(0, 0, 0, offset!!)
            }
            plugin.contentView?.addView(mRelativeLayout, params)
                ?: Log.e(TAG, "Unable to find content view")
        }
        removeFromParentView(mAdView)
        mRelativeLayout!!.addView(mAdView, paramsContent)
        mRelativeLayout!!.bringToFront()
    }

    private val isPositionTop: Boolean
        get() = gravity == Gravity.TOP

    companion object {
        private const val TAG = "AdMobPlus.Banner"

        @SuppressLint("StaticFieldLeak")
        private var rootLinearLayout: ViewGroup? = null
        @SuppressLint("StaticFieldLeak")
        private var webViewWrapper: FrameLayout? = null
        private var screenWidth = 0
        fun destroyParentView() {
            try {
                webViewWrapper?.removeAllViews()
                webViewWrapper = null
                val vg = getParentView(rootLinearLayout)
                vg?.removeAllViews()
            } finally {
                rootLinearLayout = null
            }
        }

        private fun runJustBeforeBeingDrawn(view: View, runnable: Runnable) {
            val preDrawListener: ViewTreeObserver.OnPreDrawListener =
                object : ViewTreeObserver.OnPreDrawListener {
                    override fun onPreDraw(): Boolean {
                        view.viewTreeObserver.removeOnPreDrawListener(this)
                        runnable.run()
                        return true
                    }
                }
            view.viewTreeObserver.addOnPreDrawListener(preDrawListener)
        }
    }
}

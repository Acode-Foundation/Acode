package admob.plus.cordova.ads

import admob.plus.cordova.Events
import admob.plus.cordova.ExecuteContext
import admob.plus.core.buildAdSize
import admob.plus.core.pxToDp
import android.content.res.Configuration
import android.util.Log
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.RelativeLayout
import com.google.android.gms.ads.AdListener
import com.google.android.gms.ads.AdSize
import com.google.android.gms.ads.AdView
import com.google.android.gms.ads.LoadAdError
import org.json.JSONObject
import kotlin.math.max

enum class AdSizeType {
    BANNER, LARGE_BANNER, MEDIUM_RECTANGLE, FULL_BANNER, LEADERBOARD, SMART_BANNER;

    fun getAdSize(): AdSize? = when (this) {
        BANNER -> AdSize.BANNER
        LARGE_BANNER -> AdSize.LARGE_BANNER
        MEDIUM_RECTANGLE -> AdSize.MEDIUM_RECTANGLE
        FULL_BANNER -> AdSize.FULL_BANNER
        LEADERBOARD -> AdSize.LEADERBOARD
        SMART_BANNER -> null
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

internal fun resolveBannerBottomMargin(
    originalMargin: Int,
    requestedVisible: Boolean,
    loaded: Boolean,
    measuredHeight: Int,
): Int {
    val bannerHeight =
        if (requestedVisible && loaded) max(0, measuredHeight) else 0
    return originalMargin + bannerHeight
}

internal enum class BannerLoadState {
    IDLE,
    LOADING,
    LOADED,
    FAILED,
}

internal class BannerLifecycle {
    var loadState = BannerLoadState.IDLE
        private set

    var requestedVisible = false
        private set

    val isLoaded: Boolean
        get() = loadState == BannerLoadState.LOADED

    val shouldDisplay: Boolean
        get() = requestedVisible && isLoaded

    val shouldKeepActive: Boolean
        get() = requestedVisible &&
            (loadState == BannerLoadState.LOADING || loadState == BannerLoadState.LOADED)

    fun requestLoad(): Boolean {
        if (loadState != BannerLoadState.IDLE && loadState != BannerLoadState.FAILED) {
            return false
        }

        loadState = BannerLoadState.LOADING
        return true
    }

    fun requestShow(): Boolean {
        requestedVisible = true
        return requestLoad()
    }

    fun requestHide() {
        requestedVisible = false
    }

    fun markLoaded() {
        loadState = BannerLoadState.LOADED
    }

    fun markFailed() {
        loadState = BannerLoadState.FAILED
    }

    fun restartLoad() {
        loadState = BannerLoadState.LOADING
    }

    fun reset() {
        requestedVisible = false
        loadState = BannerLoadState.IDLE
    }
}

class Banner(ctx: ExecuteContext) : AdBase(ctx) {
    private var adSize: AdSize
    private val gravity: Int
    private val offset: Int?
    private var mAdView: AdView? = null
    private var mRelativeLayout: RelativeLayout? = null
    private var mAdViewOld: AdView? = null
    private var pendingLoadEventView: AdView? = null
    private val lifecycle = BannerLifecycle()
    private var containerWidthInPixels = 0
    private var marginTarget: View? = null
    private var originalBottomMargin: Int? = null
    private var lastReportedWidth = -1
    private var lastReportedHeight = -1

    private val bannerLayoutChangeListener =
        View.OnLayoutChangeListener { view, left, top, right, bottom, _, _, _, _ ->
            val adView = view as? AdView ?: return@OnLayoutChangeListener
            if (adView !== mAdView || !lifecycle.isLoaded) {
                return@OnLayoutChangeListener
            }

            val width = max(0, right - left)
            val height = max(0, bottom - top)
            updateWebViewBottomMargin(height)
            emitMeasuredSize(adView, width, height)
        }

    override val isLoaded: Boolean
        get() = lifecycle.isLoaded

    override val canShowWhileLoading: Boolean
        get() = true

    init {
        containerWidthInPixels = currentContainerWidth()
        adSize = buildAdSize(initOpts, ctx.activity, containerWidthInPixels)
        gravity = buildGravity(initOpts)
        offset = buildOffset(initOpts)
    }

    override fun load(ctx: ExecuteContext) {
        startLoadIfNeeded(lifecycle.requestLoad())
        ctx.resolve()
    }

    private fun startLoadIfNeeded(shouldLoad: Boolean) {
        if (!shouldLoad) return

        if (mAdView == null) {
            mAdView = createBannerView()
        }
        mAdView!!.loadAd(adRequest)
        if (lifecycle.shouldKeepActive) {
            mAdView!!.resume()
        }
    }

    private fun createBannerView(): AdView {
        val adView = AdView(plugin.activity)
        adView.adUnitId = adUnitId
        adView.setAdSize(adSize)
        adView.visibility = View.INVISIBLE
        adView.addOnLayoutChangeListener(bannerLayoutChangeListener)
        adView.onPaidEventListener = paidEventListener("banner") { adView.responseInfo }
        adView.adListener = object : AdListener() {
            override fun onAdClicked() {
                emit(Events.AD_CLICK)
            }

            override fun onAdClosed() {
                emit(Events.AD_DISMISS)
            }

            override fun onAdFailedToLoad(error: LoadAdError) {
                if (adView !== mAdView) return

                lifecycle.markFailed()
                pendingLoadEventView = null
                if (mAdViewOld != null) {
                    removeBannerView(mAdViewOld!!)
                    mAdViewOld = null
                }
                applyBannerVisibility()
                emit(Events.AD_LOAD_FAIL, error)
            }

            override fun onAdImpression() {
                emit(Events.AD_IMPRESSION)
            }

            override fun onAdLoaded() {
                if (adView !== mAdView) return

                lifecycle.markLoaded()
                pendingLoadEventView = adView
                if (mAdViewOld != null) {
                    removeBannerView(mAdViewOld!!)
                    mAdViewOld = null
                }
                applyBannerVisibility()
            }

            override fun onAdOpened() {
                emit(Events.AD_SHOW)
            }
        }
        return adView
    }

    private fun computeAdSize(width: Int, height: Int): Map<String, Any> {
        val density = plugin.activity.resources.displayMetrics.density
        return mapOf(
            "size" to mapOf(
                "width" to pxToDp(width, density),
                "height" to pxToDp(height, density),
                "widthInPixels" to width,
                "heightInPixels" to height,
            )
        )
    }

    private fun emitMeasuredSize(adView: AdView, width: Int, height: Int) {
        if (width <= 0 || height <= 0) return

        val size = computeAdSize(width, height)
        if (pendingLoadEventView === adView) {
            pendingLoadEventView = null
            emit(Events.AD_LOAD, size)
        }

        if (width == lastReportedWidth && height == lastReportedHeight) return
        lastReportedWidth = width
        lastReportedHeight = height
        emit(Events.BANNER_SIZE, size)
    }

    override fun show(ctx: ExecuteContext) {
        startLoadIfNeeded(lifecycle.requestShow())
        if (mAdView?.parent == null) {
            addBannerView()
        }
        applyBannerVisibility()
        ctx.resolve()
    }

    override fun hide(ctx: ExecuteContext) {
        lifecycle.requestHide()
        applyBannerVisibility()
        ctx.resolve()
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        plugin.activity.runOnUiThread {
            webView.post {
                val width = currentContainerWidth()
                if (width != containerWidthInPixels) {
                    containerWidthInPixels = width
                    adSize = buildAdSize(initOpts, plugin.activity, width)
                    reloadBannerView()
                } else {
                    updateWebViewBottomMargin(mAdView?.height ?: 0)
                }
            }
        }
    }

    private fun reloadBannerView() {
        if (mAdView == null) return
        pauseBannerViews()
        if (mAdViewOld != null) removeBannerView(mAdViewOld!!)
        mAdViewOld = mAdView
        mAdViewOld!!.visibility = View.INVISIBLE
        lifecycle.restartLoad()
        pendingLoadEventView = null
        lastReportedWidth = -1
        lastReportedHeight = -1
        resetWebViewBottomMargin()
        mAdView = createBannerView()
        mAdView!!.loadAd(adRequest)
        addBannerView()
        applyBannerVisibility()
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
        applyBannerVisibility()
    }

    override fun onDestroy() {
        lifecycle.reset()
        resetWebViewBottomMargin()
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
        adView.removeOnLayoutChangeListener(bannerLayoutChangeListener)
        removeFromParentView(adView)
        adView.removeAllViews()
        adView.destroy()
    }

    private fun addBannerView() {
        if (mAdView == null) return
        if (offset == null) {
            if (getParentView(mAdView) === plugin.contentView && plugin.contentView != null) return
            addBannerViewWithLinearLayout()
        } else {
            if (getParentView(mAdView) === mRelativeLayout && mRelativeLayout != null) return
            addBannerViewWithRelativeLayout()
        }
        plugin.contentView?.let {
            it.requestLayout()
        }
    }

    private fun addBannerViewWithLinearLayout() {
        val wvParentView = getParentView(webView)
        if (wvParentView == null) return
        // Keep the WebView in its original parent. Add the banner to
        // contentView as a bottom-aligned sibling and push the WebView's
        // parent up via bottom margin — no removeView/reparent needed.
        removeFromParentView(mAdView)
        val content = plugin.contentView
        if (content is FrameLayout) {
            val bannerParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
                Gravity.BOTTOM
            )
            content.addView(mAdView, bannerParams)
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

    private fun applyBannerVisibility() {
        val adView = mAdView ?: run {
            resetWebViewBottomMargin()
            return
        }

        if (lifecycle.shouldDisplay) {
            adView.visibility = View.VISIBLE
            adView.resume()
            adView.requestLayout()
            adView.post {
                if (adView === mAdView && lifecycle.shouldDisplay) {
                    updateWebViewBottomMargin(adView.height)
                    emitMeasuredSize(adView, adView.width, adView.height)
                }
            }
        } else {
            adView.visibility = View.INVISIBLE
            resetWebViewBottomMargin()
            if (lifecycle.shouldKeepActive) {
                adView.resume()
            } else {
                adView.pause()
            }
        }
    }

    private fun currentContainerWidth(): Int {
        return sequenceOf(
            getParentView(webView)?.width,
            webView.width,
            plugin.contentView?.width,
            plugin.activity.resources.displayMetrics.widthPixels,
        ).firstOrNull { it != null && it > 0 }
            ?: plugin.activity.resources.displayMetrics.widthPixels
    }

    private fun updateWebViewBottomMargin(measuredHeight: Int) {
        if (offset != null) return

        val target = getParentView(webView) ?: return
        if (marginTarget !== target) {
            resetWebViewBottomMargin()
            val params = target.layoutParams as? ViewGroup.MarginLayoutParams ?: return
            marginTarget = target
            originalBottomMargin = params.bottomMargin
        }

        val params = target.layoutParams as? ViewGroup.MarginLayoutParams ?: return
        val originalMargin = originalBottomMargin ?: params.bottomMargin
        val nextMargin = resolveBannerBottomMargin(
            originalMargin,
            lifecycle.requestedVisible,
            lifecycle.isLoaded,
            measuredHeight,
        )
        if (params.bottomMargin != nextMargin) {
            params.bottomMargin = nextMargin
            target.layoutParams = params
        }
    }

    private fun resetWebViewBottomMargin() {
        val target = marginTarget
        val originalMargin = originalBottomMargin
        if (target != null && originalMargin != null) {
            val params = target.layoutParams as? ViewGroup.MarginLayoutParams
            if (params != null && params.bottomMargin != originalMargin) {
                params.bottomMargin = originalMargin
                target.layoutParams = params
            }
        }

        marginTarget = null
        originalBottomMargin = null
    }

    companion object {
        private const val TAG = "AdMobPlus.Banner"

        fun destroyParentView() {}
    }
}

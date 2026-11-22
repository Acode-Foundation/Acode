package app.acode.ads

import app.acode.ads.ads.AppOpen
import app.acode.ads.ads.Banner
import app.acode.ads.ads.Interstitial
import app.acode.ads.ads.Native
import app.acode.ads.ads.Rewarded
import app.acode.ads.ads.RewardedInterstitial
import app.acode.ads.ads.WebViewAd
import app.acode.ads.ads.getParentView
import admob.plus.core.buildRequestConfiguration
import admob.plus.core.configForTestLabIfNeeded
import admob.plus.core.isRunningInTestLab
import admob.plus.core.optFloat
import android.app.Activity
import android.content.res.Configuration
import android.util.Log
import android.view.ViewGroup
import android.webkit.WebView
import com.google.android.gms.ads.MobileAds
import com.foxdebug.acode.runtime.Callback
import com.foxdebug.acode.runtime.Service
import com.foxdebug.acode.runtime.Payload
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject


private const val TAG = "AdMobPlus"

internal fun shouldDispatchAdShow(
    isLoaded: Boolean,
    canShowWhileLoading: Boolean,
): Boolean = isLoaded || canShowWhileLoading

class AdMob : Service() {
    lateinit var context: Callback
    private var readyCallbackContext: Callback? = null
    private var sdkReady = false
    private val eventQueue: ArrayList<Payload> = arrayListOf()
    private val privacy: Privacy by lazy { Privacy(this) }

    private val actions = mapOf(
        Actions.READY to ::executeReady,
        Actions.START to ::executeStart,
        Actions.CONFIGURE to ::executeConfigure,
        Actions.AD_CREATE to ::executeAdCreate,
        Actions.AD_DESTROY to ::executeAdDestroy,
        Actions.AD_IS_LOADED to ::executeAdIsLoaded,
        Actions.AD_LOAD to ::executeAdLoad,
        Actions.AD_SHOW to ::executeAdShow,
        Actions.AD_RECOVER_PRESENTATION to ::executeAdRecoverPresentation,
        Actions.AD_HIDE to ::executeAdHide,
        Actions.PRIVACY_GATHER_CONSENT to privacy::gatherConsent,
        Actions.PRIVACY_GET_STATE to privacy::getState,
        Actions.PRIVACY_RESET_FOR_TESTING to privacy::resetForTesting,
        Actions.PRIVACY_SHOW_OPTIONS to privacy::showOptions,
        Actions.WEBVIEW_GOTO to ::executeWebviewGoto,
    )

    override fun serviceInitialize() {
        super.serviceInitialize()
        Log.i(TAG, "Initialize plugin")
    }

    @Throws(JSONException::class)
    override fun execute(
        action: String,
        data: JSONArray,
        callbackContext: Callback
    ): Boolean {
        context = callbackContext
        val ctx = ExecuteContext(action, data, callbackContext, this)
        return actions[action]?.invoke(ctx) != null
    }

    private fun executeReady(ctx: ExecuteContext): Boolean {
        if (readyCallbackContext == null) {
            for (result in eventQueue) {
                ctx.sendResult(result)
            }
            eventQueue.clear()
        } else {
            Log.e(TAG, "Ready action should only be called once.")
        }
        readyCallbackContext = ctx.callbackContext
        emit(
            Events.READY,
            mapOf("isRunningInTestLab" to isRunningInTestLab(host!!.activity))
        )
        return true
    }

    private fun executeStart(ctx: ExecuteContext) {
        val version = MobileAds.getVersion().toString()
        if (sdkReady) {
            ctx.resolve(mapOf("version" to version))
            return
        }
        MobileAds.initialize(ctx.activity) {
            configForTestLabIfNeeded(ctx.activity)
            ctx.resolve(mapOf("version" to version))
        }
        sdkReady = true
    }

    private fun executeConfigure(ctx: ExecuteContext) {
        ctx.optBoolean("appMuted")?.let {
            MobileAds.setAppMuted(it)
        }
        optFloat(ctx.opts, "appVolume")?.let {
            MobileAds.setAppVolume(it)
        }
        ctx.optBoolean("sameAppKey")?.let {
            MobileAds.putPublisherFirstPartyIdEnabled(it)
        }
        ctx.optBoolean("publisherFirstPartyIDEnabled")?.let {
            MobileAds.putPublisherFirstPartyIdEnabled(it)
        }
        MobileAds.setRequestConfiguration(buildRequestConfiguration(ctx.opts))
        configForTestLabIfNeeded(activity)
        ctx.resolve()
    }

    private fun executeAdCreate(ctx: ExecuteContext) {
        if (ctx.optId() == null) return ctx.reject("id is required")

        ctx.optString("cls")?.also {
            val ad = when (it) {
                "AppOpenAd" -> AppOpen(ctx)
                "BannerAd" -> Banner(ctx)
                "InterstitialAd" -> Interstitial(ctx)
                "NativeAd" -> Native(ctx)
                "RewardedAd" -> Rewarded(ctx)
                "RewardedInterstitialAd" -> RewardedInterstitial(ctx)
                "WebViewAd" -> WebViewAd(ctx)
                else -> null
            }
            ad?.also {
                ctx.resolve()
            } ?: ctx.reject("ad cls is not supported")
        } ?: ctx.reject("ad cls is missing")
    }

    private fun executeAdDestroy(ctx: ExecuteContext) {
        val id = ctx.optId() ?: return ctx.reject("id is required")
        host!!.activity.runOnUiThread {
            ads[id]?.onDestroy()
            ctx.resolve()
        }
    }

    private fun executeAdIsLoaded(ctx: ExecuteContext) {
        host!!.activity.runOnUiThread {
            ctx.optAdOrReject()?.let { ad ->
                ctx.resolve(ad.isLoaded)
            }
        }
    }

    private fun executeAdLoad(ctx: ExecuteContext) {
        host!!.activity.runOnUiThread {
            ctx.optAdOrReject()?.let { ad ->
                ad.load(ctx)
            }
        }
    }

    private fun executeAdShow(ctx: ExecuteContext) {
        host!!.activity.runOnUiThread {
            ctx.optAdOrReject()?.let { ad ->
                if (shouldDispatchAdShow(ad.isLoaded, ad.canShowWhileLoading)) {
                    ad.show(ctx)
                } else {
                    ctx.resolve(false)
                }
            }
        }
    }

    private fun executeAdRecoverPresentation(ctx: ExecuteContext) {
        val id = ctx.optId() ?: return ctx.reject("id is required")
        activity.runOnUiThread { ctx.resolve(recoverAdPresentation(activity, id)) }
    }

    private fun executeAdHide(ctx: ExecuteContext) {
        host!!.activity.runOnUiThread {
            ctx.optAdOrReject()?.hide(ctx)
        }
    }

    private fun executeWebviewGoto(ctx: ExecuteContext) {
        host!!.activity.runOnUiThread {
            val webView = webView!!.view as WebView
            webView.loadUrl(ctx.args.getString(0))
            ctx.resolve()
        }
    }

    val activity: Activity get() = host!!.activity

    val contentView: ViewGroup?
        get() = activity.findViewById(android.R.id.content)
            ?: getParentView(webView!!.view)

    fun emit(eventName: String, data: Map<String, Any?>) {

        val event = JSONObject(mapOf("type" to eventName, "data" to data))
        val result = Payload(Payload.Status.OK, event)
        result.keepCallback = true
        readyCallbackContext?.sendPayload(result) ?: eventQueue.add(result)
    }

    override fun onConfigurationChanged(newConfig: Configuration?) {
        super.onConfigurationChanged(newConfig)
        ads.forEach { (_, ad) ->
            ad.onConfigurationChanged(newConfig)
        }
    }

    override fun onPause(multitasking: Boolean) {
        ads.forEach { (_, ad) ->
            ad.onPause(multitasking)
        }
        super.onPause(multitasking)
    }

    override fun onResume(multitasking: Boolean) {
        super.onResume(multitasking)
        ads.forEach { (_, ad) ->
            ad.onResume(multitasking)
        }
    }

    override fun onReset() {
        clearAdState()
        super.onReset()
    }

    override fun onDestroy() {
        clearAdState()
        super.onDestroy()
    }

    private fun clearAdState() {
        readyCallbackContext = null
        eventQueue.clear()
        val previousAds = synchronized(ads) {
            ads.values.toList().also { ads.clear() }
        }
        host!!.activity.runOnUiThread {
            for (ad in previousAds) {
                ad.onDestroy()
            }
            Banner.destroyParentView()
        }
    }

    companion object {
        const val NATIVE_VIEW_DEFAULT = Native.VIEW_DEFAULT_KEY

        @JvmStatic
        fun registerNativeAdViewProviders(providers: Map<String, Native.ViewProvider>) {
            Native.providers.putAll(providers)
        }
    }
}

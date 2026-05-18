package admob.plus.cordova.ads

import admob.plus.cordova.AdMob
import admob.plus.cordova.ExecuteContext
import admob.plus.cordova.ads
import admob.plus.core.buildAdRequest
import android.content.res.Configuration
import android.view.View
import android.view.ViewGroup
import com.google.android.gms.ads.AdError
import com.google.android.gms.ads.rewarded.RewardItem
import org.apache.cordova.CordovaWebView
import org.json.JSONObject

fun getParentView(view: View?): ViewGroup? {
    return if (view == null) null else view.parent as? ViewGroup
}

fun removeFromParentView(view: View?): ViewGroup? {
    val viewParent = getParentView(view)
    viewParent?.removeView(view)
    return viewParent
}

abstract class AdBase(ctx: ExecuteContext) {
    protected val initOpts: JSONObject = ctx.args.optJSONObject(0)

    val id: String get() = initOpts.getString("id")
    val adUnitId: String get() = initOpts.getString("adUnitId")
    val adRequest get() = buildAdRequest(initOpts)

    protected val plugin = ctx.plugin

    private val cordovaWebView: CordovaWebView get() = plugin.webView
    val webView: View get() = cordovaWebView.view
    val webViewParent: ViewGroup get() = (webView.parent as? ViewGroup) ?: throw IllegalStateException("webView has no parent")

    init {
        this.also { ads[id] = it }
    }

    fun destroy() {
        plugin.activity.runOnUiThread {
            ads.remove(id)
        }
    }

    open fun onConfigurationChanged(newConfig: Configuration) {}
    open fun onPause(multitasking: Boolean) {}
    open fun onResume(multitasking: Boolean) {}
    open fun onDestroy() {
        destroy()
    }

    open val isLoaded: Boolean
        get() = TODO("Not yet implemented")

    open fun load(ctx: ExecuteContext) {
        TODO("Not yet implemented")
    }

    open fun show(ctx: ExecuteContext) {
        TODO("Not yet implemented")
    }

    open fun hide(ctx: ExecuteContext) {
        TODO("Not yet implemented")
    }

    fun emit(eventName: String, data: Map<String, Any?> = mapOf()) {
        plugin.emit(eventName, mapOf("adId" to id) + data)
    }

    fun emit(eventName: String, error: AdError) {
        emit(
            eventName, mapOf(
                "code" to error.code,
                "message" to error.message,
                "cause" to error.cause,
            )
        )
    }

    fun emit(eventName: String, rewardItem: RewardItem) {
        emit(
            eventName, mapOf(
                "reward" to mapOf(
                    "amount" to rewardItem.amount,
                    "type" to rewardItem.type,
                )
            )
        )
    }
}

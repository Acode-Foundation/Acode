package admob.plus.cordova.ads

import android.util.Log
import admob.plus.cordova.ExecuteContext

class WebViewAd(ctx: ExecuteContext) : AdBase(ctx) {
    init {
        Log.d(TAG, "WebViewAd")
    }

    override val isLoaded: Boolean
        get() = false

    override fun load(ctx: ExecuteContext) {
        ctx.resolve()
    }

    override fun show(ctx: ExecuteContext) {
        ctx.resolve()
    }

    override fun hide(ctx: ExecuteContext) {
        ctx.resolve()
    }

    companion object {
        private const val TAG = "AdMobPlus.WebViewAd"
    }
}

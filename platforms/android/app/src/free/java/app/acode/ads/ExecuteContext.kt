package app.acode.ads

import app.acode.ads.ads.AdBase
import android.app.Activity
import com.foxdebug.acode.runtime.Callback
import com.foxdebug.acode.runtime.Payload
import org.json.JSONArray
import org.json.JSONObject
import java.util.Collections.synchronizedMap

val ads = synchronizedMap(mutableMapOf<String, AdBase>())

data class ExecuteContext(
    val action: String,
    val args: JSONArray,
    val callbackContext: Callback,
    val plugin: AdMob,
) {
    val opts: JSONObject by lazy { args.optJSONObject(0) }

    val activity: Activity get() = plugin.host!!.activity

    fun optBoolean(name: String): Boolean? {
        return if (opts.has(name)) opts.optBoolean(name) else null
    }

    fun optString(name: String): String? {
        return if (opts.has(name)) opts.optString(name) else null
    }

    fun resolve() {
        callbackContext.success()
    }

    fun resolve(data: Boolean) {
        val result = Payload(Payload.Status.OK, data)
        sendResult(result)
    }

    fun resolve(data: Map<String, Any>) {
        callbackContext.success(JSONObject(data))
    }

    fun reject(msg: String?) {
        callbackContext.error(msg)
    }

    fun sendResult(result: Payload) {
        callbackContext.sendPayload(result)
    }

    fun optId(): String? {
        return optString("id")
    }

    private fun optAd(): AdBase? {
        return optId()?.let {
            ads[it]
        }
    }

    fun optAdOrReject(): AdBase? {
        return optAd() ?: let {
            reject("Ad not found")
            null
        }
    }
}

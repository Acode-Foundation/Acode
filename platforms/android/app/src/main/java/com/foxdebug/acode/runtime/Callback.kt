package com.foxdebug.acode.runtime

import android.util.Log
import com.foxdebug.acode.runtime.webview.AppWebView
import org.json.JSONException

open class Callback(private val id: Long, private val webView: AppWebView) {
    private val generation: Long = webView.bridge!!.generation

    @get:Synchronized
    var isFinished: Boolean = false
        private set

    val callbackId: String
        get() = id.toString()

    fun success() {
        sendPayload(Payload(Payload.Status.OK))
    }

    fun success(data: Any?) {
        sendPayload(Payload(Payload.Status.OK, data))
    }

    fun error(data: Any?) {
        sendPayload(Payload(Payload.Status.ERROR, data))
    }

    @Synchronized
    open fun sendPayload(payload: Payload) {
        if (this.isFinished) return
        this.isFinished = !payload.keepCallback
        if (payload.getStatus() == Payload.Status.NO_RESULT.ordinal &&
            payload.keepCallback
        ) return
        try {
            val json = payload.toJSON(id, generation).toString()
            webView.post(Runnable {
                if (generation == webView.bridge!!.generation) {
                    webView.evaluateJavascript(
                        "window.Android.callback($json);",
                        null
                    )
                }
            })
        } catch (exception: JSONException) {
            Log.e("Acode", "Unable to serialize callback", exception)
        }
    }
}

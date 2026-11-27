package com.foxdebug.acode.runtime

import android.content.Intent
import android.content.res.Configuration
import android.net.Uri
import com.foxdebug.acode.runtime.ResourceApi.OpenForReadResult
import com.foxdebug.acode.runtime.webview.AppWebView
import org.json.JSONArray
import org.json.JSONException
import java.io.FileNotFoundException
import java.io.IOException

abstract class Service {
    @JvmField
    var host: Host? = null

    @JvmField
    var webView: AppWebView? = null

    @JvmField
    var preferences: Preferences? = null

    open fun initialize(bridgeContext: BridgeContext) {
        val webActivity = bridgeContext.webActivity
        host = webActivity.getHost()
        webView = bridgeContext.webView
        preferences = host?.preferences
    }

    open fun serviceInitialize() {}

    @Throws(JSONException::class)
    open fun execute(action: String, args: String, callback: Callback): Boolean {
        return execute(action, JSONArray(args), callback)
    }

    @Throws(JSONException::class)
    open fun execute(action: String, args: JSONArray, callback: Callback): Boolean {
        return false
    }

    @Throws(JSONException::class)
    open fun onRequestPermissionResult(
        requestCode: Int,
        permissions: Array<String?>?,
        grants: IntArray?
    ) {
    }

    open fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {}

    open fun onMessage(id: String?, data: Any?): Any? {
        return null
    }

    open fun onNewIntent(intent: Intent?) {}

    open fun onPause(multitasking: Boolean) {}

    open fun onResume(multitasking: Boolean) {}

    open fun onReset() {}

    open fun onConfigurationChanged(
        configuration: Configuration?
    ) {
    }

    open fun onDestroy() {}

    open fun remapUri(uri: Uri?): Uri? {
        return null
    }

    open val pathHandler: ServicePathHandler?
        get() = null

    @Throws(IOException::class)
    fun openForRead(uri: Uri): OpenForReadResult? {
        throw FileNotFoundException(uri.toString())
    }
}

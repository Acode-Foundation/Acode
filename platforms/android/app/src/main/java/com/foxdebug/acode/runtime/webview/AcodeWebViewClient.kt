package com.foxdebug.acode.runtime.webview

import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Bitmap
import android.net.http.SslError
import android.util.Log
import android.webkit.RenderProcessGoneDetail
import android.webkit.SslErrorHandler
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import com.foxdebug.acode.BuildConfig
import com.foxdebug.acode.runtime.BaseWebActivity
import com.foxdebug.acode.runtime.Bridge
import com.foxdebug.acode.runtime.ServiceName
import java.io.ByteArrayInputStream
import java.io.IOException
import java.net.URLConnection
import java.util.Arrays

class AcodeWebViewClient(private val activity: BaseWebActivity, private val bridge: Bridge) :
    WebViewClient() {
    override fun onReceivedSslError(
        view: WebView?,
        handler: SslErrorHandler,
        error: SslError?
    ) {
        if (BuildConfig.DEBUG) handler.proceed()
        else handler.cancel()
    }

    override fun onRenderProcessGone(view: WebView?, detail: RenderProcessGoneDetail?): Boolean {
        Log.e("AcodeWebViewClient","RenderProcessGone details: $detail")
        return super.onRenderProcessGone(view, detail)
    }

    override fun onPageStarted(
        view: WebView,
        url: String?,
        icon: Bitmap?
    ) {
        (view as AppWebView).resetChrome()
        bridge.reset()
        super.onPageStarted(view, url, icon)
    }

    override fun shouldOverrideUrlLoading(
        view: WebView?,
        request: WebResourceRequest
    ): Boolean {
        val uri = request.getUrl()
        if ("https" == uri.getScheme() || "http" == uri.getScheme()
        ) return false
        if (!request.isForMainFrame()) return false
        try {
            activity.startActivity(Intent(Intent.ACTION_VIEW, uri))
        } catch (ignored: ActivityNotFoundException) {
        }
        return true
    }

    override fun shouldInterceptRequest(
        view: WebView?,
        request: WebResourceRequest
    ): WebResourceResponse? {
        val uri = request.getUrl()
        if ("https" != uri.getScheme() || "localhost" != uri.getHost()
        ) return null
        var path = uri.getPath()
        if (path == null || path == "/") path = "/index.html"
        val file = bridge.getService(ServiceName.FILE)
        val handler = file!!.pathHandler
        val response = handler!!
            .pathHandler!!
            .handle(path.substring(1))
        if (response != null) return response
        if (listOf(*path.split("/".toRegex()).dropLastWhile { it.isEmpty() }
                .toTypedArray()).contains("..") ||
            path.indexOf('\u0000') != -1
        ) return missing()
        try {
            val stream = activity.getAssets().open("bundle" + path)
            var mime = if (path.endsWith(".js"))
                "application/javascript"
            else
                if (path.endsWith(".wasm"))
                    "application/wasm"
                else
                    URLConnection.guessContentTypeFromName(path)
            if (mime == null) mime = "application/octet-stream"
            return WebResourceResponse(
                mime,
                if (mime.startsWith("text/") || mime == "application/javascript")
                    "UTF-8"
                else
                    null,
                stream
            )
        } catch (exception: IOException) {
            return missing()
        }
    }

    companion object {
        private fun missing(): WebResourceResponse {
            return WebResourceResponse(
                "text/plain",
                "UTF-8",
                404,
                "Not Found",
                mutableMapOf<String?, String?>(),
                ByteArrayInputStream(ByteArray(0))
            )
        }
    }
}

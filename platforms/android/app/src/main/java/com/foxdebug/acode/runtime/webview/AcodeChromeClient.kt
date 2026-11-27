package com.foxdebug.acode.runtime.webview

import android.Manifest
import android.graphics.Color
import android.net.Uri
import android.util.Log
import android.view.View
import android.webkit.ConsoleMessage
import android.webkit.GeolocationPermissions
import android.webkit.JsPromptResult
import android.webkit.JsResult
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.widget.FrameLayout
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.view.ViewCompat
import com.foxdebug.acode.runtime.BaseWebActivity

class AcodeChromeClient(
    private val activity: BaseWebActivity,
    private val webView: AppWebView,
) : WebChromeClient() {
    private val dialogs = Dialogs(activity)
    private val fileChooser = FileChooser(activity.getHost())
    private var pendingPermission: PermissionRequest? = null
    private var fullscreenCallback: WebChromeClient.CustomViewCallback? = null
    private var fullscreenView: FrameLayout? = null
    private var backHandler = false

    private val permissionLauncher: ActivityResultLauncher<Array<String>> =
        activity.registerForActivityResult(
            ActivityResultContracts.RequestMultiplePermissions()
        ) { grants ->
            val request = pendingPermission
            pendingPermission = null
            if (request == null) return@registerForActivityResult
            if (grants.isNotEmpty() && !grants.containsValue(false)) {
                request.grant(request.resources)
            } else {
                request.deny()
            }
        }

    private val immersive = ImmersiveFullscreen(activity, true) { backHandler = false }

    val isFullscreen: Boolean
        get() = fullscreenView != null

    fun pause() {
        immersive.pause()
    }

    fun resume() {
        immersive.resume()
    }

    fun setBackHandler(enabled: Boolean) {
        if (enabled && !isFullscreen) {
            throw IllegalStateException("Fullscreen is not active.")
        }
        backHandler = enabled
    }

    fun setOrientation(orientation: String?) {
        if (orientation == null) immersive.unlockOrientation()
        else immersive.lockOrientation(orientation)
    }

    fun handleBack(): Boolean {
        if (!isFullscreen) return false
        if (backHandler) webView.fireDocumentEvent("fullscreenbackbutton")
        else onHideCustomView()
        return true
    }

    fun reset() {
        onHideCustomView()
        dialogs.destroyLastDialog()
    }

    override fun onShowCustomView(
        view: View,
        callback: CustomViewCallback,
    ) {
        if (isFullscreen) {
            callback.onCustomViewHidden()
            return
        }
        val container = FrameLayout(activity)
        container.setBackgroundColor(Color.BLACK)
        container.addView(view, FrameLayout.LayoutParams(-1, -1))
        fullscreenCallback = callback
        fullscreenView = container
        activity.contentView.addView(container, FrameLayout.LayoutParams(-1, -1))
        webView.visibility = View.INVISIBLE
        immersive.enter(container)
        ViewCompat.requestApplyInsets(activity.contentView)
    }

    override fun onHideCustomView() {
        val container = fullscreenView ?: return
        immersive.exit()
        activity.contentView.removeView(container)
        fullscreenView = null
        webView.visibility = View.VISIBLE
        val callback = fullscreenCallback
        fullscreenCallback = null
        callback?.onCustomViewHidden()
        ViewCompat.requestApplyInsets(activity.contentView)
    }

    override fun onShowFileChooser(
        view: WebView?,
        filePathCallback: ValueCallback<Array<Uri?>?>?,
        fileChooserParams: WebChromeClient.FileChooserParams?,
    ): Boolean = fileChooser.show(view!!, filePathCallback!!, fileChooserParams!!)

    override fun onJsAlert(
        view: WebView?,
        url: String?,
        message: String?,
        result: JsResult,
    ): Boolean {
        dialogs.showAlert(message) { success, _ ->
            if (success) result.confirm() else result.cancel()
        }
        return true
    }

    override fun onJsConfirm(
        view: WebView?,
        url: String?,
        message: String?,
        result: JsResult,
    ): Boolean {
        dialogs.showConfirm(message) { success, _ ->
            if (success) result.confirm() else result.cancel()
        }
        return true
    }

    override fun onJsPrompt(
        view: WebView?,
        url: String?,
        message: String?,
        defaultValue: String?,
        result: JsPromptResult,
    ): Boolean {
        dialogs.showPrompt(message, defaultValue) { success, input ->
            if (success) result.confirm(input) else result.cancel()
        }
        return true
    }

    override fun onGeolocationPermissionsShowPrompt(
        origin: String?,
        callback: GeolocationPermissions.Callback,
    ) {
        callback.invoke(origin, true, false)
    }

    override fun onPermissionRequest(request: PermissionRequest) {
        val permissions = mutableListOf<String>()
        for (resource in request.resources) {
            when (resource) {
                PermissionRequest.RESOURCE_VIDEO_CAPTURE ->
                    permissions.add(Manifest.permission.CAMERA)

                PermissionRequest.RESOURCE_AUDIO_CAPTURE -> {
                    permissions.add(Manifest.permission.MODIFY_AUDIO_SETTINGS)
                    permissions.add(Manifest.permission.RECORD_AUDIO)
                }
            }
        }
        if (permissions.isEmpty()) {
            request.grant(request.resources)
        } else {
            pendingPermission?.deny()
            pendingPermission = request
            permissionLauncher.launch(permissions.toTypedArray())
        }
    }

    override fun onPermissionRequestCanceled(request: PermissionRequest?) {
        if (pendingPermission === request) pendingPermission = null
    }

    override fun onConsoleMessage(message: ConsoleMessage): Boolean {
        Log.d(
            "AcodeWebView",
            "${message.message()} at ${message.sourceId()}:${message.lineNumber()}",
        )
        return true
    }
}

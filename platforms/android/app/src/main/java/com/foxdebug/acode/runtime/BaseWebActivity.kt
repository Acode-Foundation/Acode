package com.foxdebug.acode.runtime

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.os.Bundle
import android.util.Log
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.webkit.CookieManager
import android.webkit.WebView
import android.widget.FrameLayout
import androidx.activity.OnBackPressedCallback
import androidx.activity.OnBackPressedDispatcher
import androidx.appcompat.app.AppCompatActivity
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.view.OnApplyWindowInsetsListener
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import com.foxdebug.acode.BuildConfig
import com.foxdebug.acode.runtime.webview.AppWebView
import com.foxdebug.acode.runtime.webview.AcodeChromeClient
import com.foxdebug.acode.runtime.webview.AcodeWebViewClient
import org.json.JSONException
import java.lang.ref.WeakReference
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.max

open class BaseWebActivity : AppCompatActivity() {
    private var appWebView: AppWebView? = null
    private var host: Host? = null
    private var bridge: Bridge? = null
    private var acodeChromeClient: AcodeChromeClient? = null
    private var content: FrameLayout? = null
    private var hasPaused = false
    private val overriddenButtons: MutableSet<String?> = ConcurrentHashMap.newKeySet<String?>()

    @SuppressLint("SetJavaScriptEnabled")
    public override fun onCreate(state: Bundle?) {
        installSplashScreen()
        super.onCreate(state)
        context = WeakReference<Context?>(this)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        host = Host(this)
        content = FrameLayout(this)
        appWebView = AppWebView(this)
        bridge = Bridge(appWebView!!,this)
        appWebView!!.initialize(bridge!!)
        acodeChromeClient = AcodeChromeClient(this, appWebView!!)
        appWebView!!.webViewClient = AcodeWebViewClient(this, bridge!!)
        appWebView!!.webChromeClient = acodeChromeClient!!
        appWebView!!.setFullscreenController(acodeChromeClient!!)
        appWebView!!.addJavascriptInterface(bridge!!, "Android")
        appWebView!!.isVerticalScrollBarEnabled = false
        appWebView!!.settings.javaScriptEnabled = true
        appWebView!!.settings.javaScriptCanOpenWindowsAutomatically = true
        appWebView!!.settings.setSaveFormData(false)
        appWebView!!.settings.setGeolocationEnabled(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(
            appWebView,
            true
        )
        appWebView!!.settings.domStorageEnabled = true
        appWebView!!.settings.setDatabaseEnabled(true)
        appWebView!!.settings.allowFileAccess = true
        appWebView!!.settings.allowContentAccess = true
        appWebView!!.settings.mediaPlaybackRequiresUserGesture = false
        appWebView!!.overScrollMode = View.OVER_SCROLL_NEVER
        appWebView!!.setBackgroundColor(-0xcececf)
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        content!!.addView(appWebView, FrameLayout.LayoutParams(-1, -1))
        val statusBar = View(this)
        statusBar.tag = "statusBarView"
        content!!.addView(statusBar)
        setContentView(content)
        ViewCompat.setOnApplyWindowInsetsListener(
            content!!,
            OnApplyWindowInsetsListener { view: View?, insets: WindowInsetsCompat? ->
                val bars = insets!!.getInsets(
                    WindowInsetsCompat.Type.systemBars() or
                            WindowInsetsCompat.Type.displayCutout()
                )
                val keyboard = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
                val fullscreen = acodeChromeClient!!.isFullscreen
                val top =
                    if (!fullscreen && statusBar.visibility != View.GONE) bars.top else 0
                val params =
                    appWebView!!.layoutParams as FrameLayout.LayoutParams
                val left = if (fullscreen) 0 else bars.left
                val right = if (fullscreen) 0 else bars.right
                val bottom = if (fullscreen) 0 else max(bars.bottom, keyboard)
                if (params.leftMargin != left || params.topMargin != top || params.rightMargin != right || params.bottomMargin != bottom
                ) {
                    params.setMargins(left, top, right, bottom)
                    appWebView!!.layoutParams = params
                }
                statusBar.layoutParams = FrameLayout.LayoutParams(-1, top, Gravity.TOP)
                insets
            })

       OnBackPressedDispatcher().addCallback(
            this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    dispatchBack()
                }
            }
        )
        bridge!!.initialize()
        appWebView!!.loadUrl("https://localhost/index.html")
    }

    fun overrideButton(button: String, enabled: Boolean) {
        var button = button
        if (button == "volumeup" || button == "volumedown") button +=
            "button"
        if (enabled) overriddenButtons.add(button)
        else overriddenButtons.remove(button)
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (appWebView == null) return super.dispatchKeyEvent(event)
        val code = event.keyCode
        if (code == KeyEvent.KEYCODE_BACK &&
            (acodeChromeClient!!.isFullscreen || overriddenButtons.contains("backbutton"))
        ) {
            if (event.action == KeyEvent.ACTION_UP) dispatchBack()
            return true
        }
        val name =
            if (code == KeyEvent.KEYCODE_MENU)
                "menubutton"
            else
                if (code == KeyEvent.KEYCODE_VOLUME_UP)
                    "volumeupbutton"
                else
                    if (code == KeyEvent.KEYCODE_VOLUME_DOWN)
                        "volumedownbutton"
                    else
                        null
        if (name != null && overriddenButtons.contains(name)) {
            if (event.action == KeyEvent.ACTION_UP
            ) appWebView!!.fireDocumentEvent(name)
            return true
        }
        return super.dispatchKeyEvent(event)
    }

    private fun dispatchBack() {
        if (acodeChromeClient!!.handleBack()) return
        if (overriddenButtons.contains("backbutton")) appWebView!!.fireDocumentEvent(
            "backbutton"
        )
        else if (appWebView!!.canGoBack()) appWebView!!.goBack()
        else finish()
    }

    fun getHost(): Host {
        return host!!
    }

    val contentView: FrameLayout
        get() = content!!

    override fun onConfigurationChanged(
        configuration: Configuration
    ) {
        super.onConfigurationChanged(configuration)
        for (service in bridge!!.activeServices) service.onConfigurationChanged(configuration)
    }

    public override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        setIntent(intent)
        for (service in bridge!!.activeServices) service.onNewIntent(intent)
    }

    override fun onPause() {
        super.onPause()
        if (appWebView == null) return
        hasPaused = true
        appWebView!!.fireDocumentEvent("pause")
        for (service in bridge!!.activeServices) service.onPause(true)
        acodeChromeClient!!.pause()
    }

    override fun onResume() {
        super.onResume()
        if (appWebView == null) return
        appWebView!!.onResume()
        appWebView!!.resumeTimers()
        acodeChromeClient!!.resume()
        for (service in bridge!!.activeServices) service.onResume(true)
        if (hasPaused) appWebView!!.fireDocumentEvent("resume")
    }

    override fun onActivityResult(code: Int, result: Int, data: Intent?) {
        super.onActivityResult(code, result, data)
        if (!host!!.onActivityResult(code, result, data)) {
            for (service in bridge!!.activeServices) service.onActivityResult(code, result, data)
        }
    }

    override fun onRequestPermissionsResult(
        code: Int,
        permissions: Array<String?>,
        grants: IntArray
    ) {
        super.onRequestPermissionsResult(code, permissions, grants)
        try {
            if (!host!!.onPermissionsResult(code, permissions, grants)) {
                for (service in bridge!!.activeServices) service.onRequestPermissionResult(
                    code,
                    permissions,
                    grants
                )
            }
        } catch (exception: JSONException) {
            Log.e("Acode", "Permission callback failed", exception)
        }
    }

    override fun onDestroy() {
        if (bridge != null) bridge!!.destroy()
        if (acodeChromeClient != null) acodeChromeClient!!.reset()
        if (appWebView != null) {
            content!!.removeView(appWebView)
            appWebView!!.destroy()
        }
        super.onDestroy()
    }

    companion object {
        private var context: WeakReference<Context?>? = null
        fun getContext(): Context? {
            return if (context == null) null else context!!.get()
        }
    }
}

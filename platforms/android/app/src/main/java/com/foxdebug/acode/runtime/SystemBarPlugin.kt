/*
    Licensed to the Apache Software Foundation (ASF) under one
    or more contributor license agreements.  See the NOTICE file
    distributed with this work for additional information
    regarding copyright ownership.  The ASF licenses this file
    to you under the Apache License, Version 2.0 (the
    "License"); you may not use this file except in compliance
    with the License.  You may obtain a copy of the License at

        http://www.apache.org/licenses/LICENSE-2.0

    Unless required by applicable law or agreed to in writing,
    software distributed under the License is distributed on an
    "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
    KIND, either express or implied.  See the License for the
    specific language governing permissions and limitations
    under the License.
*/
package com.foxdebug.acode.runtime

import android.R
import android.annotation.SuppressLint
import android.content.Context
import android.content.res.Configuration
import android.content.res.Resources
import android.graphics.Color
import android.os.Build
import android.util.Log
import android.view.View
import android.view.WindowInsetsController
import android.widget.FrameLayout
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import com.foxdebug.acode.runtime.webview.AppWebView
import org.json.JSONArray
import org.json.JSONException
import java.util.Objects
import kotlin.math.roundToInt
import androidx.core.view.size
import androidx.core.graphics.toColorInt
import com.foxdebug.acode.settings.AppPreferences
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.DelicateCoroutinesApi
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.GlobalScope
import kotlinx.coroutines.launch
import okhttp3.Dispatcher

class SystemBarPlugin : Service() {
    // Internal variables
    private var context: Context? = null
    private var resources: Resources? = null
    private var overrideStatusBarBackgroundColor: Int? = null

    private var canEdgeToEdge = false

    private lateinit var bridgeContext: BridgeContext

    override fun initialize(bridgeContext: BridgeContext) {
        super.initialize(bridgeContext)
        this.bridgeContext = bridgeContext
        context = bridgeContext.webActivity
        resources = bridgeContext.webActivity.resources
        canEdgeToEdge = AppPreferences.getBoolean("AndroidEdgeToEdge", false)
    }

    @OptIn(DelicateCoroutinesApi::class)
    override fun execute(action: String, args: JSONArray, callback: Callback): Boolean {
        when (action) {
            "setStatusBarVisible" -> {
                val visible = args.getBoolean(0)
                GlobalScope.launch(Dispatchers.Main) { setStatusBarVisible(visible) }
            }
            "setStatusBarBackgroundColor" -> {
                GlobalScope.launch(Dispatchers.Main) { setStatusBarBackgroundColor(args!!)}
            }
            else -> {
                return false
            }
        }

        callback.success()
        return true
    }


    public override fun onConfigurationChanged(newConfig: Configuration?) {
        super.onConfigurationChanged(newConfig)
        GlobalScope.launch(Dispatchers.Main) {
            updateSystemBars()
        }
    }

    public override fun onResume(multitasking: Boolean) {
        super.onResume(multitasking)
        GlobalScope.launch(Dispatchers.Main) {
            updateSystemBars()
        }

    }

    override fun onMessage(id: String?, data: Any?): Any? {
        if (id == "updateSystemBars") {
            GlobalScope.launch(Dispatchers.Main) {
                updateSystemBars()
            }
        }
        return null
    }

    /**
     * Allow the app to override the status bar visibility from JS API.
     * If for some reason the statusBarView could not be discovered, it will silently ignore
     * the change request
     * 
     * @param visible should the status bar be visible?
     */
    private fun setStatusBarVisible(visible: Boolean) {
        val statusBar = getStatusBarView(bridgeContext.webView)
        if (statusBar != null) {
            statusBar.visibility = if (visible) View.VISIBLE else View.GONE

            val rootLayout = getRootLayout(bridgeContext.webView)
            if (rootLayout != null) {
                ViewCompat.requestApplyInsets(rootLayout)
            }
        }
    }

    /**
     * Allow the app to override the status bar background color from JS API.
     * If the supplied ARGB is invalid or fails to parse, it will silently ignore
     * the change request.
     * 
     * @param argbVals {R, G, B, A}
     */
    private fun setStatusBarBackgroundColor(argbVals: JSONArray) {
        try {
            val r = argbVals.getInt(0)
            val g = argbVals.getInt(1)
            val b = argbVals.getInt(2)
            val a = (255 * argbVals.optDouble(3, 1.0).toFloat()).roundToInt()

            overrideStatusBarBackgroundColor = Color.argb(a, r, g, b)
            updateStatusBar(overrideStatusBarBackgroundColor!!)
        } catch (e: JSONException) {
            // Silently skip
        }
    }

    /**
     * Attempt to update all system bars (status, navigation and gesture bars) in various points
     * of the apps life cycle.
     * For example:
     * 1. Device configurations between (E.g. between dark and light mode)
     * 2. User resumes the app
     * 3. App transitions from SplashScreen Theme to App's Theme
     */
    private fun updateSystemBars() {
        // Update Root View Background Color
        var rootViewBackgroundColor = this.preferenceBackgroundColor
        if (rootViewBackgroundColor == null) {
            rootViewBackgroundColor = if (canEdgeToEdge) Color.TRANSPARENT else this.uiModeColor
        }
        updateRootView(rootViewBackgroundColor)

        // Update StatusBar Background Color
        val statusBarBackgroundColor: Int?
        if (overrideStatusBarBackgroundColor != null) {
            statusBarBackgroundColor = overrideStatusBarBackgroundColor
        } else if (AppPreferences.contains("StatusBarBackgroundColor")) {
            statusBarBackgroundColor = this.preferenceStatusBarBackgroundColor
        } else if (AppPreferences.contains("BackgroundColor")) {
            statusBarBackgroundColor = rootViewBackgroundColor
        } else {
            statusBarBackgroundColor = if (canEdgeToEdge) Color.TRANSPARENT else this.uiModeColor
        }

        updateStatusBar(statusBarBackgroundColor!!)
    }

    /**
     * Updates the root layout's background color with the supplied color int.
     * It will also determine if the background color is light or dark to properly adjust the
     * appearance of the navigation/gesture bar's icons so it will not clash with the background.
     * 
     * 
     * System bars (navigation & gesture) on SDK 25 or lower is forced to black as the appearance
     * of the fonts can not be updated.
     * System bars (navigation & gesture) on SDK 26 or greater allows custom background color.
     * 
     * 
     * 
     * @param bgColor Background color
     */
    @Suppress("deprecation")
    private fun updateRootView(bgColor: Int) {
        val window = bridgeContext.webActivity.getWindow()

        // Set the root view's background color. Works on SDK 36+
        val root = bridgeContext.webActivity.findViewById<View?>(R.id.content)
        if (root != null) root.setBackgroundColor(bgColor)

        // Automatically set the font and icon color of the system bars based on background color.
        val isBackgroundColorLight: Boolean
        if (bgColor == Color.TRANSPARENT) {
            isBackgroundColorLight = isColorLight(this.uiModeColor)
        } else {
            isBackgroundColorLight = isColorLight(bgColor)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val controller = window.insetsController
            if (controller != null) {
                val appearance = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                if (isBackgroundColorLight) {
                    controller.setSystemBarsAppearance(appearance, appearance)
                } else {
                    controller.setSystemBarsAppearance(0, appearance)
                }
            }
        }
        val controllerCompat = WindowCompat.getInsetsController(window, window.getDecorView())
        controllerCompat.isAppearanceLightNavigationBars = isBackgroundColorLight

        window.navigationBarColor = bgColor
    }

    /**
     * Updates the statusBarView background color with the supplied color int.
     * It will also determine if the background color is light or dark to properly adjust the
     * appearance of the status bar so the font will not clash with the background.
     * 
     * @param bgColor Background color
     */
    private fun updateStatusBar(bgColor: Int) {
        val window = bridgeContext.webActivity.window

        val statusBar = getStatusBarView(bridgeContext.webView)
        statusBar?.setBackgroundColor(bgColor)

        // Automatically set the font and icon color of the system bars based on background color.
        val isStatusBarBackgroundColorLight: Boolean
        if (bgColor == Color.TRANSPARENT) {
            isStatusBarBackgroundColorLight = isColorLight(this.uiModeColor)
        } else {
            isStatusBarBackgroundColorLight = isColorLight(bgColor)
        }
        val controllerCompat = WindowCompat.getInsetsController(window, window.decorView)
        controllerCompat.isAppearanceLightStatusBars = isStatusBarBackgroundColorLight
    }

    private val preferenceStatusBarBackgroundColor: Int
        /**
         * Returns the StatusBarBackgroundColor preference value or [.getUiModeColor] as fallback.
         * 
         * @return Integer
         */
        get() {
            val colorString =
                AppPreferences.getString("StatusBarBackgroundColor", null)
            return Objects.requireNonNullElse<Int>(
                parseColorFromString(colorString),
                this.uiModeColor
            )
        }

    private val preferenceBackgroundColor: Int?
        /**
         * Returns the BackgroundColor preference value.
         * If the value is missing or fails to decode, null is returned.
         * 
         * @return Integer|null
         */
        get() {
            if (!AppPreferences.contains("BackgroundColor")) {
                return null
            }

            try {
                return AppPreferences.getInteger("BackgroundColor", 0)
            } catch (e: NumberFormatException) {
                Log.e(
                    PLUGIN_NAME,
                    "Invalid background color argument. Example valid string: '0x00000000'"
                )
                return null
            }
        }

    /**
     * Tries to find and return the rootLayout.
     * 
     * @param webView AppView
     * @return FrameLayout|null
     */
    private fun getRootLayout(webView: AppWebView): FrameLayout? {
        val parent = webView.view.parent
        if (parent is FrameLayout) {
            return parent
        }

        return null
    }

    /**
     * Tries to find and return the statusBarView.
     * 
     * @param webView AppView
     * @return View|null
     */
    private fun getStatusBarView(webView: AppWebView): View? {
        val rootView = getRootLayout(webView) ?: return null

        for (i in 0..<rootView.size) {
            val child = rootView.getChildAt(i)
            val tag = child.tag
            if ("statusBarView" == tag) {
                return child
            }
        }
        return null
    }

    @get:SuppressLint("DiscouragedApi")
    private val uiModeColor: Int
        /**
         * Determines the background color for status bar & root layer.
         * The color will come from the app's R.color.cdv_background_color.
         * If for some reason the resource is missing, it will try to fallback on the uiMode.
         * 
         * 
         * The uiMode as follows.
         * If night mode: "#121318" (android.R.color.system_background_dark)
         * If day mode: "#FAF8FF" (android.R.color.system_background_light)
         * If all fails, light mode will be returned.
         * 
         * The hex values are supplied instead of "android.R.color" for backwards compatibility.
         * 
         * @return int color
         */
        get() {
            val isNightMode =
                (resources!!.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
            val fallbackColor = if (isNightMode) "#121318" else "#FAF8FF"
            val colorResId =
                resources!!.getIdentifier(
                    "cdv_background_color",
                    "color",
                    context!!.packageName
                )
            return if (colorResId != 0)
                ContextCompat.getColor(context!!, colorResId)
            else
                fallbackColor.toColorInt()
        }

    /**
     * Parses a color string provided by app developers.
     * If the color string is empty or unable to parse, null is returned.
     * 
     * @param colorPref hex string value, #AARRGGBB or #RRGGBB
     * @return Integer|null
     */
    private fun parseColorFromString(colorPref: String?): Int? {
        if (colorPref.isNullOrEmpty()) return null

        try {
            return colorPref.toColorInt()
        } catch (ignore: IllegalArgumentException) {
            Log.e(PLUGIN_NAME, "Invalid color hex code. Valid format: #RRGGBB or #AARRGGBB")
            return null
        }
    }

    companion object {
        const val PLUGIN_NAME: String = "SystemBarPlugin"

        /**
         * Determines if the supplied color's appearance is light.
         * 
         * @param color color
         * @return boolean value true is returned when the color is light.
         */
        private fun isColorLight(color: Int): Boolean {
            val r = Color.red(color) / 255.0
            val g = Color.green(color) / 255.0
            val b = Color.blue(color) / 255.0
            val luminance = 0.299 * r + 0.587 * g + 0.114 * b
            return luminance > 0.5
        }
    }
}

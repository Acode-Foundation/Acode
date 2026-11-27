package com.foxdebug.acode.runtime.webview

import android.app.Activity
import android.content.pm.ActivityInfo
import android.os.Build
import android.view.View
import android.view.View.OnAttachStateChangeListener
import android.view.ViewTreeObserver
import android.view.ViewTreeObserver.OnWindowFocusChangeListener
import android.view.Window
import android.view.WindowManager
import androidx.core.view.OnApplyWindowInsetsListener
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

/** Owns window state only while Acode is displaying a browser fullscreen view.  */
internal class ImmersiveFullscreen
    (private val activity: Activity, private var resumed: Boolean, private val onExit: Runnable) :
    OnWindowFocusChangeListener, OnAttachStateChangeListener {
    private val window: Window
    private val decor: View
    private val controller: WindowInsetsControllerCompat
    private var fullscreenView: View? = null
    private var focusObserver: ViewTreeObserver? = null
    private var statusBarVisible = false
    private var navigationBarVisible = false
    private var previousBehavior = 0
    private var previousCutoutMode = 0
    private var previousLegacyFlags = 0
    private var requestedOrientation: Int? = null
    private var previousOrientation = 0
    private var orientationApplied = false

    init {
        window = activity.getWindow()
        decor = window.getDecorView()
        controller = WindowCompat.getInsetsController(window, decor)
    }

    @Suppress("deprecation")
    fun enter(view: View) {
        if (fullscreenView != null) return

        val insets = ViewCompat.getRootWindowInsets(decor)
        val flags = decor.getSystemUiVisibility()
        statusBarVisible =
            if (insets != null)
                insets.isVisible(WindowInsetsCompat.Type.statusBars())
            else
                (flags and View.SYSTEM_UI_FLAG_FULLSCREEN) == 0 &&
                        (window.getAttributes().flags and
                                WindowManager.LayoutParams.FLAG_FULLSCREEN) == 0
        navigationBarVisible =
            if (insets != null)
                insets.isVisible(WindowInsetsCompat.Type.navigationBars())
            else
                (flags and View.SYSTEM_UI_FLAG_HIDE_NAVIGATION) == 0
        previousBehavior = controller.getSystemBarsBehavior()
        previousLegacyFlags = flags and LEGACY_FULLSCREEN_FLAGS
        if (Build.VERSION.SDK_INT >= 28) {
            val attributes = window.getAttributes()
            previousCutoutMode = attributes.layoutInDisplayCutoutMode
            attributes.layoutInDisplayCutoutMode =
                if (Build.VERSION.SDK_INT >= 30)
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
                else
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
            window.setAttributes(attributes)
        }

        fullscreenView = view
        // The wrapper fills Acode's root, with no status/navigation bar margins.
        // Only the keyboard should shrink the usable area. Leave the root's inset
        // listener alone so normal editor layout is unchanged on exit.
        ViewCompat.setOnApplyWindowInsetsListener(
            view,
            OnApplyWindowInsetsListener { target: View?, appliedInsets: WindowInsetsCompat? ->
                val bottom = appliedInsets!!
                    .getInsets(WindowInsetsCompat.Type.ime())
                    .bottom
                target!!.setPadding(0, 0, 0, bottom)
                appliedInsets
            })
        view.addOnAttachStateChangeListener(this)
        focusObserver = decor.getViewTreeObserver()
        focusObserver!!.addOnWindowFocusChangeListener(this)
        reapply()
        ViewCompat.requestApplyInsets(view)
    }

    fun reapply() {
        if (!resumed || fullscreenView == null || !fullscreenView!!.isAttachedToWindow() || !decor.hasWindowFocus()
        ) return
        controller.setSystemBarsBehavior(
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        )
        controller.hide(WindowInsetsCompat.Type.systemBars())
    }

    fun lockOrientation(orientation: String?) {
        val requested: Int
        if ("landscape" == orientation) {
            requested = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        } else if ("portrait" == orientation) {
            requested = ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT
        } else {
            throw IllegalArgumentException(
                "Orientation must be landscape or portrait."
            )
        }
        check(
            !(!resumed || fullscreenView == null || !fullscreenView!!.isAttachedToWindow()
                    )
        ) { "Orientation requires foreground fullscreen." }

        val previous = activity.getRequestedOrientation()
        activity.setRequestedOrientation(requested)
        // Only a successful first request owns the restoration state. Changing
        // modes or resuming this session must not replace it with our own override.
        if (requestedOrientation == null) previousOrientation = previous
        requestedOrientation = requested
        orientationApplied = true
    }

    fun unlockOrientation() {
        restoreOrientation()
        requestedOrientation = null
    }

    fun pause() {
        resumed = false
        restoreOrientation()
    }

    fun resume() {
        resumed = true
        if (fullscreenView != null &&
            fullscreenView!!.isAttachedToWindow() && requestedOrientation != null
        ) {
            activity.setRequestedOrientation(requestedOrientation!!)
            orientationApplied = true
        }
        reapply()
    }

    private fun restoreOrientation() {
        if (!orientationApplied) return
        activity.setRequestedOrientation(previousOrientation)
        orientationApplied = false
    }

    @Suppress("deprecation")
    fun exit() {
        if (fullscreenView == null) return
        val view = fullscreenView
        fullscreenView = null
        onExit.run()
        unlockOrientation()
        view!!.removeOnAttachStateChangeListener(this)
        ViewCompat.setOnApplyWindowInsetsListener(view, null)
        view.setPadding(0, 0, 0, 0)
        if (focusObserver!!.isAlive()
        ) focusObserver!!.removeOnWindowFocusChangeListener(this)
        focusObserver = null

        controller.setSystemBarsBehavior(previousBehavior)
        restoreBar(WindowInsetsCompat.Type.statusBars(), statusBarVisible)
        restoreBar(WindowInsetsCompat.Type.navigationBars(), navigationBarVisible)
        if (Build.VERSION.SDK_INT < 30) {
            // Restore only the bits we own; keep any theme changes made meanwhile.
            decor.setSystemUiVisibility(
                (decor.getSystemUiVisibility() and LEGACY_FULLSCREEN_FLAGS.inv()) or
                        previousLegacyFlags
            )
        }
        if (Build.VERSION.SDK_INT >= 28) {
            val attributes = window.getAttributes()
            attributes.layoutInDisplayCutoutMode = previousCutoutMode
            window.setAttributes(attributes)
        }
        ViewCompat.requestApplyInsets(decor)
    }

    private fun restoreBar(type: Int, visible: Boolean) {
        if (visible) controller.show(type)
        else controller.hide(type)
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        if (hasFocus) reapply()
    }

    override fun onViewAttachedToWindow(view: View) {}

    override fun onViewDetachedFromWindow(view: View) {
        exit()
    }

    companion object {
        @Deprecated("Using old methods, needs rewrite")
        private const val LEGACY_FULLSCREEN_FLAGS = View.SYSTEM_UI_FLAG_FULLSCREEN or
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_IMMERSIVE or
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
    }
}

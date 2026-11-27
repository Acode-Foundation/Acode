package com.foxdebug.acode.runtime.webview

import android.content.Context
import android.graphics.Rect
import android.text.InputType
import android.view.ActionMode
import android.view.Menu
import android.view.MenuItem
import android.view.View
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputConnection
import android.webkit.WebView
import com.foxdebug.acode.runtime.Bridge
import com.foxdebug.acode.runtime.ResourceApi
import org.json.JSONObject

class AppWebView(context: Context) : WebView(context) {
    private var inputType = -1
    private var nativeContextMenuDisabled = false
    var bridge: Bridge? = null
        private set
    var resourceApi: ResourceApi? = null
        private set
    private var fullscreen: AcodeChromeClient? = null

    fun initialize(bridge: Bridge) {
        this.bridge = bridge
        resourceApi = ResourceApi(getContext(), bridge)
    }

    val view: AppWebView
        get() = this

    val engine: AppWebView
        get() = this

    fun setInputType(type: Int) {
        inputType = type
    }

    fun setNativeContextMenuDisabled(disabled: Boolean) {
        nativeContextMenuDisabled = disabled
    }

    fun setFullscreenController(fullscreen: AcodeChromeClient) {
        this.fullscreen = fullscreen
    }

    fun resetChrome() {
        fullscreen!!.reset()
    }

    fun setFullscreenBackHandler(enabled: Boolean) {
        fullscreen!!.setBackHandler(enabled)
    }

    fun setFullscreenOrientation(orientation: String?) {
        fullscreen!!.setOrientation(orientation)
    }

    fun fireDocumentEvent(event: String?) {
        evaluateJavascript(
            "window.Bridge && Bridge.fireDocumentEvent(" +
                    JSONObject.quote(event) +
                    ");",
            null
        )
    }

    override fun onCreateInputConnection(attrs: EditorInfo): InputConnection? {
        val connection = super.onCreateInputConnection(attrs)
        if (inputType == 0) attrs.inputType = attrs.inputType or
                InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
        else if (inputType == 1) attrs.inputType =
            InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS or
                    InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
        return connection
    }

    override fun startActionMode(callback: ActionMode.Callback?): ActionMode? {
        return suppress(super.startActionMode(wrap(callback)))
    }

    override fun startActionMode(callback: ActionMode.Callback?, type: Int): ActionMode? {
        return suppress(super.startActionMode(wrap(callback), type))
    }

    override fun startActionModeForChild(
        child: View?,
        callback: ActionMode.Callback?
    ): ActionMode? {
        return suppress(super.startActionModeForChild(child, wrap(callback)))
    }

    override fun startActionModeForChild(
        child: View?,
        callback: ActionMode.Callback?,
        type: Int
    ): ActionMode? {
        return suppress(super.startActionModeForChild(child, wrap(callback), type))
    }

    private fun wrap(callback: ActionMode.Callback?): ActionMode.Callback? {
        if (!nativeContextMenuDisabled || callback == null) return callback
        return object : ActionMode.Callback2() {
            override fun onCreateActionMode(mode: ActionMode?, menu: Menu?): Boolean {
                val created = callback.onCreateActionMode(mode, menu)
                if (created) suppressUi(mode, menu)
                return created
            }

            override fun onPrepareActionMode(mode: ActionMode?, menu: Menu?): Boolean {
                val prepared = callback.onPrepareActionMode(mode, menu)
                suppressUi(mode, menu)
                return prepared
            }

            override fun onActionItemClicked(mode: ActionMode?, item: MenuItem?): Boolean {
                return callback.onActionItemClicked(mode, item)
            }

            override fun onDestroyActionMode(mode: ActionMode?) {
                callback.onDestroyActionMode(mode)
            }

            override fun onGetContentRect(mode: ActionMode?, view: View?, rect: Rect?) {
                if (callback is ActionMode.Callback2) callback.onGetContentRect(mode, view, rect)
                else super.onGetContentRect(mode, view, rect)
            }
        }
    }

    private fun suppress(mode: ActionMode?): ActionMode? {
        if (nativeContextMenuDisabled && mode != null) suppressUi(
            mode,
            mode.menu
        )
        return mode
    }

    private fun suppressUi(mode: ActionMode?, menu: Menu?) {
        if (mode == null || !nativeContextMenuDisabled || menu == null) return
        menu.clear()
        mode.title = null
        mode.subtitle = null
        post {
            if (!nativeContextMenuDisabled) return@post
            try {
                mode.hide(0)
            } catch (ignored: Throwable) {
            }
        }
    }
}

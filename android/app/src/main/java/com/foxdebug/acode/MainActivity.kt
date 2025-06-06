package com.foxdebug.acode

import android.content.Context
import android.os.Build
import android.os.Bundle
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.lifecycle.lifecycleScope
import com.foxdebug.acode.plugins.NativeLayer
import com.getcapacitor.BridgeActivity
import kotlinx.coroutines.CoroutineScope
import java.lang.ref.WeakReference


class MainActivity : BridgeActivity() {

    companion object {
        private var activityRef: WeakReference<MainActivity?>? = WeakReference(null)

        fun getActivityContext(): Context? {
            return activityRef?.get()
        }

        val lifeCycleScope: CoroutineScope
            get() {
                return activityRef?.get()?.lifecycleScope ?: throw IllegalStateException("Activity is not available")
            }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        //register plugins before calling super
        registerPlugin(NativeLayer::class.java)

        super.onCreate(savedInstanceState)
        activityRef = WeakReference(this)

        // only apply insets for android 13+
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ViewCompat.setOnApplyWindowInsetsListener(window.decorView) { v, insets ->
                val systemBarsInsets = insets.getInsets(WindowInsetsCompat.Type.systemBars())
                val imeInsets = insets.getInsets(WindowInsetsCompat.Type.ime())
                val isImeVisible = insets.isVisible(WindowInsetsCompat.Type.ime())

                v.setPadding(
                    systemBarsInsets.left,
                    systemBarsInsets.top,
                    systemBarsInsets.right,
                    if (isImeVisible) imeInsets.bottom else systemBarsInsets.bottom
                )
                insets
            }
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        activityRef = WeakReference(null)
        activityRef = null
    }
}

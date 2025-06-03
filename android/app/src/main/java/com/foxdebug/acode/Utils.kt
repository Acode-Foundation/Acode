package com.foxdebug.acode

import com.foxdebug.acode.plugins.NativeLayer
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

fun NativeLayer.runOnUiThread(callback: CoroutineScope.() -> Unit) {
    scope.launch { callback() }
}

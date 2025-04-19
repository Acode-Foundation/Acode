package com.foxdebug.acode

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.DelicateCoroutinesApi
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.GlobalScope
import kotlinx.coroutines.launch

object Utils {
    //guarantees the runnable to be run on the main thread
    @OptIn(DelicateCoroutinesApi::class)
    fun runOnUiThread(callback: CoroutineScope.() -> Unit) {
        GlobalScope.launch(Dispatchers.Main){
            callback.invoke(this)
        }
    }
}
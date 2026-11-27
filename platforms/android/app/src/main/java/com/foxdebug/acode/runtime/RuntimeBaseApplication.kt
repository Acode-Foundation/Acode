package com.foxdebug.acode.runtime

import android.app.Application
import kotlinx.coroutines.CoroutineScope
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

open class RuntimeBaseApplication : Application() {
    private var executorService: ExecutorService? = null
    private var executorServiceSingle: ExecutorService? = null

    override fun onCreate() {
        super.onCreate()
        instance = this
        executorService = Executors.newCachedThreadPool()
        executorServiceSingle = Executors.newSingleThreadExecutor()
    }

    @Deprecated(message = "Directly using System threads or threadPools is not reccomended", replaceWith = ReplaceWith("Coroutines"))
    val threadPool: ExecutorService?
        get() = executorService

    @Deprecated(message = "Directly using System threads or threadPools is not reccomended", replaceWith = ReplaceWith("Coroutines"))
    val threadPoolSingle: ExecutorService?
        get() = executorServiceSingle

    override fun onTerminate() {
        executorService!!.shutdownNow()
        executorServiceSingle!!.shutdownNow()
        super.onTerminate()
    }

    companion object {
        @JvmStatic
        var instance: RuntimeBaseApplication? = null
            private set
    }
}

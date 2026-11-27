package com.foxdebug.acode.runtime

import android.net.Uri
import android.util.Log
import android.webkit.JavascriptInterface
import com.foxdebug.acode.runtime.RuntimeBaseApplication.Companion.instance
import com.foxdebug.acode.runtime.webview.AppWebView
import kotlin.collections.LinkedHashMap

data class BridgeContext(val webView: AppWebView,val webActivity: BaseWebActivity)

class Bridge(private val webView: AppWebView, private val webActivity: BaseWebActivity) {
    private val definitions: Map<ServiceName, ServiceDefinition> =
        ServiceRegistry.definitions.associateBy { definition -> definition.name }

    private val definitionsByKey: Map<String, ServiceDefinition> =
        ServiceRegistry.definitions.associateBy { definition -> definition.name.key }

    private val services: MutableMap<String, Service> = LinkedHashMap()

    @Volatile
    var generation: Long = 0
        private set

    /** Services created so far, in the order they were requested. */
    val activeServices: List<Service>
        get() = services.values.toList()

    fun initialize() {
        definitions.values
            .filter { definition -> definition.loadOnStart }
            .forEach { definition -> getService(definition) }
    }

    @Synchronized
    fun getService(definition: ServiceDefinition): Service {
        return services.getOrPut(definition.name.key) {
            definition.factory.create().also { service ->
                service.initialize(BridgeContext(webView, webActivity))
                service.serviceInitialize()
            }
        }
    }

    @Synchronized
    fun getService(name: ServiceName): Service? {
        return definitions[name]?.let { definition -> getService(definition) }
    }

    @JavascriptInterface
    fun exec(name: String?, action: String, args: String, id: Long): Boolean {
        val callback = Callback(id, webView)
        val definition = name?.let { definitionsByKey[it] }
        if (definition == null) {
            callback.error("Unknown native service: $name")
            return true
        }
        val requestGeneration = generation
        webView.post {
            if (generation != requestGeneration) return@post
            try {
                val service = getService(definition)
                instance!!
                    .threadPoolSingle!!
                    .execute {
                        if (generation != requestGeneration) return@execute
                        try {
                            if (!service.execute(action, args, callback)) {
                                callback.sendPayload(
                                    Payload(Payload.Status.INVALID_ACTION, action)
                                )
                            }
                        } catch (exception: Exception) {
                            Log.e(TAG, "Service $name failed to execute $action", exception)
                            callback.error(exception.toString())
                        }
                    }
            } catch (exception: Exception) {
                Log.e(TAG, "Unable to run service $name", exception)
                callback.error(exception.toString())
            }
        }
        return true
    }

    fun remapUri(uri: Uri?): Uri? {
        for (service in activeServices) {
            val result = service.remapUri(uri)
            if (result != null) return result
        }
        return null
    }

    fun postMessage(name: String?, value: Any?) {
        for (service in activeServices) service.onMessage(name, value)
    }

    fun reset() {
        generation++
        for (service in activeServices) service.onReset()
    }

    fun destroy() {
        generation++
        for (service in activeServices) service.onDestroy()
        services.clear()
    }

    companion object {
        private const val TAG = "Bridge"
    }
}

package com.foxdebug.acode.runtime

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.core.app.ActivityCompat
import org.json.JSONArray
import org.json.JSONException
import java.util.concurrent.ExecutorService

class App : Service() {
    private lateinit var bridgeContext: BridgeContext

    override fun initialize(bridgeContext: BridgeContext) {
        super.initialize(bridgeContext)
        this.bridgeContext = bridgeContext
    }

    @Throws(JSONException::class)
    override fun execute(action: String, args: JSONArray, callback: Callback): Boolean {
        val webView = bridgeContext.webView
        when (action) {
            "exitApp" -> host!!.activity.runOnUiThread(Runnable { host!!.activity.finish() })
            "overrideButton" -> host!!.activity
                .overrideButton(args.getString(0), args.getBoolean(1))

            "clearCache" -> webView.post(Runnable { webView.clearCache(true) })
            "clearHistory" -> webView.post(Runnable { webView.clearHistory() })
            "backHistory" -> webView.post(Runnable { webView.goBack() })
            else -> return false
        }
        callback.success()
        return true
    }
}

class Host(val activity: BaseWebActivity) {
    val preferences: Preferences = Preferences()
    private val permissionRequests: MutableMap<Int?, Request?> = HashMap<Int?, Request?>()
    private val activityRequests: MutableMap<Int?, Request?> = HashMap<Int?, Request?>()
    private var requestId = 40000

    init {
        preferences.set("AndroidPersistentFileLocation", "Compatibility")
        preferences.set("AndroidBlacklistSecureSocketProtocols", "SSLv3,TLSv1")
        preferences.set("scheme", "https")
        preferences.set("hostname", "localhost")
        preferences.set("BackgroundColor", -0xcececf)
    }

    val context: Context
        get() = activity

    val threadPool: ExecutorService?
        get() = RuntimeBaseApplication.instance!!.threadPool

    fun hasPermission(permission: String): Boolean {
        return (ActivityCompat.checkSelfPermission(activity, permission) ==
                PackageManager.PERMISSION_GRANTED
                )
    }

    fun requestPermission(service: Service, code: Int, permission: String?) {
        requestPermissions(service, code, arrayOf<String?>(permission))
    }

    fun requestPermissions(
        service: Service,
        code: Int,
        permissions: Array<String?>
    ) {
        activity.runOnUiThread(Runnable {
            val id = requestId++
            permissionRequests[id] = Request(service, code)
            ActivityCompat.requestPermissions(activity, permissions, id)
        })
    }

    fun startActivityForResult(service: Service, intent: Intent, code: Int) {
        activity.runOnUiThread(Runnable {
            val id = requestId++
            activityRequests[id] = Request(service, code)
            activity.startActivityForResult(intent, id)
        })
    }

    @Throws(JSONException::class)
    fun onPermissionsResult(id: Int, permissions: Array<String?>?, grants: IntArray?): Boolean {
        val request = permissionRequests.remove(id) ?: return false
        request.service.onRequestPermissionResult(
            request.code,
            permissions,
            grants
        )
        return true
    }

    fun onActivityResult(id: Int, result: Int, data: Intent?): Boolean {
        val request = activityRequests.remove(id) ?: return false
        request.service.onActivityResult(request.code, result, data)
        return true
    }

    private class Request(val service: Service, val code: Int)
}
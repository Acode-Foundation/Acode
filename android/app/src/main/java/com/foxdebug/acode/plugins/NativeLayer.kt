package com.foxdebug.acode.plugins

import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.appcompat.app.AlertDialog
import com.foxdebug.acode.Acode
import com.foxdebug.acode.runOnUiThread
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.CoroutineName
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.cancel
import kotlinx.coroutines.plus
import androidx.core.net.toUri

@CapacitorPlugin(name = "NativeLayer")
class NativeLayer : Plugin() {
    val scope = MainScope() + CoroutineName("NativeLayer")

    override fun handleOnDestroy() {
        super.handleOnDestroy()
        scope.cancel()
    }

    /**
     * Displays a simple alert dialog with a title, message, and an "OK" button.
     *
     * @param call The PluginCall containing the dialog parameters. It expects the following keys:
     *   - `title`: (String) The title of the dialog.
     *   - `message`: (String) The message content of the dialog.
     *
     * The dialog will display the provided title and message. If either `title` or `message` is not provided, the call will be rejected with an error.
     * When the user clicks the "OK" button, the dialog will be dismissed, and the plugin call will be resolved.
     */
    @PluginMethod
    fun showDialog(call: PluginCall) = with(call) {
        autoRejectOnError(onFailure = {}) {
            existsNot("title") { return@with }
            existsNot("message") { return@with }

            val title = call.getString("title")
            val message = call.getString("message")

            runOnUiThread {
                AlertDialog.Builder(context).apply {
                    setTitle(title)
                    setMessage(message)
                    setPositiveButton("OK", null)
                    show()
                }
            }
            
            call.resolve()
        }

    }

    /**
     * Launches an intent based on the provided parameters.
     *
     * @param call The PluginCall containing the intent parameters.
     *   The following parameters are expected:
     *   - `constructor_number`: (Int) The type of intent constructor to use.
     *     - `0`: Creates an intent using an action string. Requires `action`.
     *     - `1`: Creates an explicit intent using a class name. Requires `className`.
     *     - `2`: Creates a generic intent.
     *   - `launch_type`: (String) The type of intent launch.
     *     - `"activity"`: Starts an activity.
     *     - `"service"`: Starts a service.
     *   - `activity_context`: (Boolean) Whether to use the activity context. If `false`, uses the application context.
     *   - `action`: (String) The action for the intent (required for `constructor_number` 0).
     *   - `className`: (String) The fully qualified class name to launch (required for `constructor_number` 1).
     *   - `new_task`: (Boolean) Whether to launch the intent in a new task.
     *   - `extras`: (JSObject) Key-value pairs to add as extras to the intent. Supported types are String, Int, Boolean, Double, and Float.
     *   - `data`: (String, optional) URI to set as the intent data.
     *   - `type`: (String, optional) MIME type for the intent.
     *   - `package`: (String, optional) Package name for an explicit intent.
     *   - `class`: (String, optional) Class name for an explicit intent. Should be used alongside `package`.
     *   - `foreground_service`: (Boolean, optional) Indicates if the service is a foreground service. (required for service launch)
     *     Only applies when `launch_type` is "service". Requires API 26+.
     *
     * If `launch_type` is "service" and `foreground_service` is `true`, it starts a foreground service.
     * Otherwise, it starts a regular background service.
     *
     * If any required parameters are missing or invalid, the call will be rejected with an appropriate error message.
     */
    @PluginMethod
    fun launchIntent(call: PluginCall) {
        call.autoRejectOnError(onFailure = {}) {
            val constructorNumber = call.getInt("constructor_number") ?: run {
                call.reject("Missing 'constructor_number'")
                return
            }

            val launchType = call.getString("launch_type") ?: run {
                call.reject("Missing 'launch_type'")
                return
            }

            val useActivityContext = call.getBoolean("activity_context") ?: run {
                call.reject("Missing 'activity_context'")
                return
            }

            val context = if (useActivityContext) context else Acode.instance.applicationContext

            val intent = when (constructorNumber) {
                0 -> {
                    val action = call.getString("action") ?: run {
                        call.reject("Missing 'action' for constructor 0")
                        return
                    }
                    Intent(action)
                }

                1 -> {
                    val className = call.getString("className") ?: run {
                        call.reject("Missing 'class' for constructor 1")
                        return
                    }
                    Intent(context, Class.forName(className))
                }

                2 -> {
                    Intent()
                }

                else -> {
                    call.reject("Unsupported constructor_number: $constructorNumber")
                    return
                }
            }

            if (call.getBoolean("new_task") == true) {
                intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK
            }

            call.getObject("extras", JSObject())?.let { extras ->
                for (key in extras.keys()) {
                    when (val value = extras.get(key)) {
                        is String -> intent.putExtra(key, value)
                        is Int -> intent.putExtra(key, value)
                        is Boolean -> intent.putExtra(key, value)
                        is Double -> intent.putExtra(key, value)
                        is Float -> intent.putExtra(key, value)
                        else -> {
                            call.reject("Unsupported data type encountered while processing intent extras")
                            return
                        }
                    }
                }
            }

            call.getString("data")?.let { intent.data = it.toUri() }
            call.getString("type")?.let(intent::setType)

            if (call.data.has("package") && call.data.has("class")) {
                val pkg = call.getString("package")
                val cls = call.getString("class")
                if (pkg != null && cls != null) {
                    intent.setClassName(pkg, cls)
                }
            }

            when (launchType) {
                "activity" -> {
                    context.startActivity(intent)
                    call.resolve()
                }

                "service" -> {
                    val isForeground = call.getBoolean("foreground_service") ?: run {
                        call.reject("Missing 'foreground_service' for service launch")
                        return
                    }

                    if (isForeground) {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                            context.startForegroundService(intent)
                            call.resolve()
                        } else {
                            call.unavailable("Foreground service requires API 26+")
                        }
                    } else {
                        context.startService(intent)
                        call.resolve()
                    }
                }

                else -> {
                    call.reject("Invalid launch_type: $launchType")
                }
            }
        }
    }
}

package com.foxdebug.acode.plugins

import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.appcompat.app.AlertDialog
import com.foxdebug.acode.Acode
import com.foxdebug.acode.MainActivity
import com.foxdebug.acode.Utils
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "NativeLayer")
class NativeLayer : Plugin() {

    /**
     * Displays a dialog with the provided title and message.
     *
     * @param call The PluginCall containing the dialog parameters. It should contain:
     *             - `title`: The title of the dialog (String).
     *             - `message`: The message displayed in the dialog (String).
     *
     * If either `title` or `message` is missing, the call will be rejected with an appropriate error message.
     * Upon clicking "OK", the dialog will resolve the call.
     */
    @PluginMethod
    fun showDialog(call: PluginCall) = with(call){
        autoRejectOnError(onFailure = {}){
            existsNot("title"){
                return@with
            }
            existsNot("message"){
                return@with
            }

            val title = call.getString("title")
            val message = call.getString("message")

            Utils.runOnUiThread {
                val context = MainActivity.getActivityContext()
                if (context == null) {
                    call.reject("Context is null")
                    return@runOnUiThread
                }
                AlertDialog.Builder(context).apply {
                    setTitle(title)
                    setMessage(message)
                    setPositiveButton("OK",null)
                    show()
                }
                call.resolve()
            }
        }

    }

    /**
     * Launches an intent based on the provided parameters.
     *
     * @param call The PluginCall containing the intent parameters. It should contain:
     *             - `constructor_number`: The type of intent constructor to use (Int).
     *             - `launch_type`: The type of intent launch ("activity" or "service").
     *             - `activity_context`: Whether to use the activity context (Boolean).
     *             - `action`: The action for the intent (String) (for constructor 0).
     *             - `className`: The class name to launch (String) (for constructor 1).
     *             - `new_task`: Whether to launch the intent in a new task (Boolean).
     *             - `extras`: A JSObject containing key-value pairs to add as extras to the intent.
     *             - `data`: Optional URI to set as the intent data.
     *             - `type`: Optional MIME type for the intent.
     *             - `package` and `class`: Optional package and class for explicit intents.
     *
     * This method supports multiple constructors based on the `constructor_number`:
     * - `0`: Uses an action string to create an intent.
     * - `1`: Uses a class name to create an explicit intent.
     * - `2`: Creates a generic intent.
     *
     * If the `launch_type` is "activity", it starts an activity.
     * If the `launch_type` is "service", it starts a service, and you can specify if it's a foreground service.
     *
     * If any required parameters are missing, the call will be rejected with an appropriate error message.
     */
    @PluginMethod
    fun launchIntent(call: PluginCall) {
        call.autoRejectOnError(onFailure = {}){
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

            val context = if (useActivityContext) MainActivity.getActivityContext() else Acode.instance
            if (context == null) {
                call.reject("Requested context is not available")
                return
            }

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

            call.getString("data")?.let {
                intent.data = Uri.parse(it)
            }

            call.getString("type")?.let {
                intent.type = it
            }

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

package com.foxbyte.acode

import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.FileObserver
import android.provider.DocumentsContract
import android.text.TextUtils
import android.util.Log
import androidx.documentfile.provider.DocumentFile
import org.apache.cordova.CallbackContext
import org.apache.cordova.PluginResult
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.io.OutputStream

// Assuming context, formatUri, filename, and callback exist in the enclosing scope/class
class SDCardManager(private val context: Context) {

    private var contentResolver: ContentResolver? = null

    fun getFileInfo(filename: String, callback: CallbackContext, formatUri: (String) -> String) {
        // Kotlin runnable execution using SAM conversion
        Runnable {
            val fileUri = formatUri(filename)

            try {
                val file = getFile(fileUri)

                if (file != null) {
                    val result = JSONObject().apply {
                        put("exists", file.exists())
                        put("canRead", file.canRead())
                        put("canWrite", canWrite(file.uri))
                        put("name", file.name)
                        put("length", file.length())
                        put("type", file.type)
                        put("isFile", file.isFile)
                        put("isDirectory", file.isDirectory)
                        put("isVirtual", file.isVirtual)
                        put("lastModified", file.lastModified())
                        put("url", file.uri.toString())
                    }
                    callback.success(result)
                } else {
                    callback.error("File not found")
                }
            } catch (e: Exception) {
                callback.error(e.message)
            }
        }.run()
    }

    private fun getUri(src: String, docId: String): Uri {
        val srcUri = Uri.parse(src)
        val srcId = DocumentsContract.getTreeDocumentId(srcUri)
        val buildUri = DocumentsContract.buildDocumentUriUsingTree(srcUri, srcId)
        return DocumentsContract.buildDocumentUriUsingTree(buildUri, docId)
    }

    private fun exists(path: String, callback: CallbackContext) {
        val file = DocumentFile.fromSingleUri(context, Uri.parse(path))

        if (file == null) {
            callback.error("Unable to get file")
        } else {
            if (file.exists()) {
                callback.success("TRUE")
            } else {
                callback.success("FALSE")
            }
        }
    }

    private fun error(err: String, callback: CallbackContext) {
        callback.error("ERROR: $err")
    }

    private fun getPath(uriString: String, src: String, callback: CallbackContext) {
        try {
            val file = getRelativeDocumentFile(uriString, src)

            if (file == null) {
                callback.error("Unable to get file")
            } else {
                val uri = file.uri
                val path = uri.path

                if (path != null) {
                    callback.success(uri.toString())
                } else {
                    callback.error("Unable to get path")
                }
            }
        } catch (e: Exception) {
            callback.error(e.message)
        }
    }

    private fun getRelativeDocumentFile(uri: String, filename: String): DocumentFile? {
        var currentFileName = filename
        val paths = mutableListOf<String>()

        var file: DocumentFile? = DocumentFile.fromTreeUri(context, Uri.parse(uri))
            ?: return null

        if (!canWrite(file!!.uri)) {
            throw RuntimeException("Cannot write file")
        }

        paths.addAll(currentFileName.split("/"))

        while (paths.isNotEmpty()) {
            val path = paths.removeAt(0)
            currentFileName = TextUtils.join("/", paths)

            if (path.isNotEmpty()) {
                file = file?.findFile(path)
                if (file == null) return null
            }
        }

        return file
    }

    private fun getFile(uri: Uri): DocumentFile? {
        return getFile(uri.toString())
    }

    private fun getFile(filePath: String): DocumentFile? {
        val fileUri = Uri.parse(filePath)

        return if (filePath.matches(Regex("file:///(.*)"))) {
            val path = fileUri.path
            if (path != null) DocumentFile.fromFile(File(path)) else null
        } else {
            DocumentFile.fromSingleUri(context, fileUri)
        }
    }

    private fun takePermission(uri: Uri) {
        contentResolver = context.contentResolver
        contentResolver?.takePersistableUriPermission(
            uri,
            Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION
        )
    }

    fun canWrite(uri: Uri): Boolean {
        var canWrite = false
        try {
            // Open stream to verify write permissions
            val os: OutputStream? = context.contentResolver.openOutputStream(uri, "wa")
            if (os != null) {
                os.close()
                canWrite = true
            }
        } catch (ignored: SecurityException) {
        } catch (ignored: IllegalArgumentException) {
        } catch (ignored: IOException) {
        }
        return canWrite
    }
}

class MyFileObserver : FileObserver {

    private val listener: CallbackContext

    companion object {
        private const val MASK = DELETE_SELF or MODIFY or MOVE_SELF
    }

    constructor(path: String, listener: CallbackContext) : super(path, MASK) {
        this.listener = listener
        Log.d("MyFileObserver", "MyFileObserver: $path")
    }

    @Suppress("DEPRECATION")
    constructor(file: File, listener: CallbackContext) : super(file.absolutePath, MASK) {
        this.listener = listener
        Log.d("MyFileObserver", "MyFileObserver: ${file.absolutePath}")
    }

    override fun onEvent(event: Int, path: String?) {
        Log.d("MyFileObserver", "onEvent: $event")
        val result = PluginResult(PluginResult.Status.OK).apply {
            keepCallback = true
        }
        listener.sendPluginResult(result)
    }

    fun startObserving() {
        startWatching()
    }

    fun stopObserving() {
        stopWatching()
    }
}

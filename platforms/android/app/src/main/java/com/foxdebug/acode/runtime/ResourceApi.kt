/*
    Licensed to the Apache Software Foundation (ASF) under one
    or more contributor license agreements.  See the NOTICE file
    distributed with this work for additional information
    regarding copyright ownership.  The ASF licenses this file
    to you under the Apache License, Version 2.0 (the
    "License"); you may not use this file except in compliance
    with the License.  You may obtain a copy of the License at

        http://www.apache.org/licenses/LICENSE-2.0

    Unless required by applicable law or agreed to in writing,
    software distributed under the License is distributed on an
    "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
    KIND, either express or implied.  See the License for the
    specific language governing permissions and limitations
    under the License.
*/
package com.foxdebug.acode.runtime

import android.content.ContentResolver
import android.content.Context
import android.content.res.AssetFileDescriptor
import android.content.res.AssetManager
import android.net.Uri
import android.os.Looper
import android.util.Base64
import android.webkit.MimeTypeMap
import java.io.ByteArrayInputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileNotFoundException
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.io.UnsupportedEncodingException
import java.net.HttpURLConnection
import java.net.URL
import java.util.Locale
import java.util.zip.GZIPInputStream


class ResourceApi(context: Context, private val pluginManager: Bridge) {
    private val assetManager: AssetManager = context.assets
    private val contentResolver: ContentResolver = context.contentResolver
    var isThreadCheckingEnabled: Boolean = true


    fun remapUri(uri: Uri): Uri {
        assertNonRelative(uri)
        val pluginUri = pluginManager.remapUri(uri)
        return pluginUri ?: uri
    }

    fun remapPath(path: String): String? {
        return remapUri(Uri.fromFile(File(path))).path
    }

    /**
     * @return A file that points to the resource, or null if the resource is not on the local filesystem.
     */
    fun mapUriToFile(uri: Uri): File? {
        assertBackgroundThread()
        when (getUriType(uri)) {
            URI_TYPE_FILE -> return File(uri.path!!)
            URI_TYPE_CONTENT -> {
                val cursor = contentResolver.query(uri, LOCAL_FILE_PROJECTION, null, null, null)
                cursor?.use { cursor ->
                    val columnIndex = cursor.getColumnIndex(LOCAL_FILE_PROJECTION[0])
                    if (columnIndex != -1 && cursor.count > 0) {
                        cursor.moveToFirst()
                        val realPath = cursor.getString(columnIndex)
                        if (realPath != null) {
                            return File(realPath)
                        }
                    }
                }
            }
        }
        return null
    }

    fun getMimeType(uri: Uri): String? {
        when (getUriType(uri)) {
            URI_TYPE_FILE, URI_TYPE_ASSET -> return getMimeTypeFromPath(uri.path!!)
            URI_TYPE_CONTENT, URI_TYPE_RESOURCE -> return contentResolver.getType(uri)
            URI_TYPE_DATA -> {
                return getDataUriMimeType(uri)
            }

            URI_TYPE_HTTP, URI_TYPE_HTTPS -> {
                try {
                    val conn = URL(uri.toString()).openConnection() as HttpURLConnection
                    conn.setDoInput(false)
                    conn.requestMethod = "HEAD"
                    var mimeType = conn.getHeaderField("Content-Type")
                    if (mimeType != null) {
                        mimeType = mimeType.split(";".toRegex()).dropLastWhile { it.isEmpty() }
                            .toTypedArray()[0]
                    }
                    return mimeType
                } catch (e: IOException) {
                }
            }
        }

        return null
    }


    //This already exists
    private fun getMimeTypeFromPath(path: String): String? {
        var extension = path
        val lastDot = extension.lastIndexOf('.')
        if (lastDot != -1) {
            extension = extension.substring(lastDot + 1)
        }
        // Convert the URI string to lower case to ensure compatibility with MimeTypeMap (see CB-2185).
        extension = extension.lowercase(Locale.getDefault())
        if (extension == "3ga") {
            return "audio/3gpp"
        } else if (extension == "js") {
            // Missing from the map :(.
            return "text/javascript"
        }
        return MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension)
    }

    /**
     * Opens a stream to the given URI, also providing the MIME type & length.
     * 
     * @return Never returns null.
     * @throws IllegalArgumentException For relative URIs. Relative URIs should be resolved before
     * being passed into this function.
     * @throws IOException              If the URI cannot be opened.
     * @throws IllegalStateException    If called on a foreground thread and skipThreadCheck is false.
     */
    /**
     * Opens a stream to the given URI, also providing the MIME type & length.
     * 
     * @return Never returns null.
     * @throws IllegalArgumentException For relative URIs. Relative URIs should be resolved before
     * being passed into this function.
     * @throws IOException              If the URI cannot be opened.
     * @throws IllegalStateException    If called on a foreground thread.
     */
    @JvmOverloads
    @Throws(IOException::class)
    fun openForRead(uri: Uri, skipThreadCheck: Boolean = false): OpenForReadResult? {
        if (!skipThreadCheck) {
            assertBackgroundThread()
        }
        when (getUriType(uri)) {
            URI_TYPE_FILE -> {
                val inputStream = FileInputStream(uri.path)
                val mimeType = getMimeTypeFromPath(uri.path!!)
                val length = inputStream.channel.size()
                return OpenForReadResult(uri, inputStream, mimeType, length, null)
            }

            URI_TYPE_ASSET -> {
                val assetPath = uri.path!!.substring(15)
                var assetFd: AssetFileDescriptor? = null
                var inputStream: InputStream
                var length: Long = -1
                try {
                    assetFd = assetManager.openFd(assetPath)
                    inputStream = assetFd.createInputStream()
                    length = assetFd.length
                } catch (e: FileNotFoundException) {
                    // Will occur if the file is compressed.
                    inputStream = assetManager.open(assetPath)
                    length = inputStream.available().toLong()
                }
                val mimeType = getMimeTypeFromPath(assetPath)
                return OpenForReadResult(uri, inputStream, mimeType, length, assetFd)
            }

            URI_TYPE_CONTENT, URI_TYPE_RESOURCE -> {
                val mimeType = contentResolver.getType(uri)
                val assetFd = contentResolver.openAssetFileDescriptor(uri, "r")
                val inputStream: InputStream = assetFd!!.createInputStream()
                val length = assetFd.length
                return OpenForReadResult(uri, inputStream, mimeType, length, assetFd)
            }

            URI_TYPE_DATA -> {
                val ret = readDataUri(uri)
                return ret
            }

            URI_TYPE_HTTP, URI_TYPE_HTTPS -> {
                val conn = URL(uri.toString()).openConnection() as HttpURLConnection
                conn.setRequestProperty("Accept-Encoding", "gzip")
                conn.setDoInput(true)
                var mimeType = conn.getHeaderField("Content-Type")
                if (mimeType != null) {
                    mimeType = mimeType.split(";".toRegex()).dropLastWhile { it.isEmpty() }
                        .toTypedArray()[0]
                }
                val length = conn.contentLength
                val inputStream: InputStream
                if ("gzip" == conn.contentEncoding) {
                    inputStream = GZIPInputStream(conn.getInputStream())
                } else {
                    inputStream = conn.getInputStream()
                }
                return OpenForReadResult(uri, inputStream, mimeType, length.toLong(), null)
            }

            URI_TYPE_PLUGIN -> {
                //wtf is this?
                //i am commenting this for now
                //probably break uri stuff

//                val plugin = ServiceName.fromKey(uri.host)?.let { name ->
//                    pluginManager.getService(name)
//                } ?: throw FileNotFoundException("Invalid plugin ID in URI: $uri")
//                return plugin.openForRead(uri)
            }
        }
        throw FileNotFoundException("URI not supported by ResourceApi: $uri")
    }

    /**
     * Opens a stream to the given URI.
     * 
     * @return Never returns null.
     * @throws IllegalArgumentException For relative URIs. Relative URIs should be resolved before
     * being passed into this function.
     * @throws IOException              If the URI cannot be opened.
     */
    @JvmOverloads
    @Throws(IOException::class)
    fun openOutputStream(uri: Uri, append: Boolean = false): OutputStream? {
        assertBackgroundThread()
        when (getUriType(uri)) {
            URI_TYPE_FILE -> {
                val localFile = File(uri.path!!)
                val parent = localFile.parentFile
                if (parent != null) {
                    parent.mkdirs()
                }
                return FileOutputStream(localFile, append)
            }

            URI_TYPE_CONTENT, URI_TYPE_RESOURCE -> {
                val assetFd =
                    contentResolver.openAssetFileDescriptor(uri, if (append) "wa" else "w")
                return assetFd!!.createOutputStream()
            }
        }
        throw FileNotFoundException("URI not supported by ResourceApi: $uri")
    }

    @Throws(IOException::class)
    fun createHttpConnection(uri: Uri): HttpURLConnection? {
        assertBackgroundThread()
        return URL(uri.toString()).openConnection() as HttpURLConnection?
    }

    // Copies the input to the output in the most efficient manner possible.
    // Closes both streams.
    @Throws(IOException::class)
    fun copyResource(input: OpenForReadResult, outputStream: OutputStream?) {
        assertBackgroundThread()
        try {
            val inputStream = input.inputStream
            if (inputStream is FileInputStream && outputStream is FileOutputStream) {
                val inChannel = input.inputStream.channel
                val outChannel = outputStream.channel
                var offset: Long = 0
                val length = input.length
                if (input.assetFd != null) {
                    offset = input.assetFd.startOffset
                }
                // transferFrom()'s 2nd arg is a relative position. Need to set the absolute
                // position first.
                inChannel.position(offset)
                outChannel.transferFrom(inChannel, 0, length)
            } else {
                val BUFFER_SIZE = 8192
                val buffer = ByteArray(BUFFER_SIZE)

                while (true) {
                    val bytesRead = inputStream.read(buffer, 0, BUFFER_SIZE)

                    if (bytesRead <= 0) {
                        break
                    }
                    outputStream!!.write(buffer, 0, bytesRead)
                }
            }
        } finally {
            input.inputStream.close()
            outputStream?.close()
        }
    }

    @Throws(IOException::class)
    fun copyResource(sourceUri: Uri, outputStream: OutputStream?) {
        copyResource(openForRead(sourceUri)!!, outputStream)
    }

    // Added in 3.5.0.
    @Throws(IOException::class)
    fun copyResource(sourceUri: Uri, dstUri: Uri) {
        copyResource(openForRead(sourceUri)!!, openOutputStream(dstUri))
    }

    private fun assertBackgroundThread() {
        if (this.isThreadCheckingEnabled) {
            val curThread = Thread.currentThread()
            check(
                curThread !== Looper.getMainLooper().thread
            ) { "Do not perform IO operations on the UI thread. Use Host.getThreadPool() instead." }
            check(curThread !== jsThread) { "Tried to perform an IO operation on the WebCore thread. Use Host.getThreadPool() instead." }
        }
    }

    private fun getDataUriMimeType(uri: Uri): String? {
        val uriAsString = uri.schemeSpecificPart
        val commaPos = uriAsString.indexOf(',')
        if (commaPos == -1) {
            return null
        }
        val mimeParts: Array<String?> =
            uriAsString.substring(0, commaPos).split(";".toRegex()).dropLastWhile { it.isEmpty() }
                .toTypedArray()
        if (mimeParts.isNotEmpty()) {
            return mimeParts[0]
        }
        return null
    }

    private fun readDataUri(uri: Uri): OpenForReadResult? {
        val uriAsString = uri.schemeSpecificPart
        val commaPos = uriAsString.indexOf(',')
        if (commaPos == -1) {
            return null
        }
        val mimeParts: Array<String?> =
            uriAsString.substring(0, commaPos).split(";".toRegex()).dropLastWhile { it.isEmpty() }
                .toTypedArray()
        var contentType: String? = null
        var base64 = false
        if (mimeParts.isNotEmpty()) {
            contentType = mimeParts[0]
        }
        for (i in 1..<mimeParts.size) {
            if ("base64".equals(mimeParts[i], ignoreCase = true)) {
                base64 = true
            }
        }
        val dataPartAsString = uriAsString.substring(commaPos + 1)
        var data: ByteArray
        if (base64) {
            data = Base64.decode(dataPartAsString, Base64.DEFAULT)
        } else {
            try {
                data = dataPartAsString.toByteArray(charset("UTF-8"))
            } catch (e: UnsupportedEncodingException) {
                data = dataPartAsString.toByteArray()
            }
        }
        val inputStream: InputStream = ByteArrayInputStream(data)
        return OpenForReadResult(uri, inputStream, contentType, data.size.toLong(), null)
    }

    class OpenForReadResult(
        val uri: Uri?,
        @JvmField val inputStream: InputStream,
        @JvmField val mimeType: String?,
        @JvmField val length: Long,
        val assetFd: AssetFileDescriptor?
    )

    companion object {
        @Suppress("unused")
        private const val LOG_TAG = "ResourceApi"

        const val URI_TYPE_FILE: Int = 0
        const val URI_TYPE_ASSET: Int = 1
        const val URI_TYPE_CONTENT: Int = 2
        const val URI_TYPE_RESOURCE: Int = 3
        const val URI_TYPE_DATA: Int = 4
        const val URI_TYPE_HTTP: Int = 5
        const val URI_TYPE_HTTPS: Int = 6
        const val URI_TYPE_PLUGIN: Int = 7
        const val URI_TYPE_UNKNOWN: Int = -1

        const val PLUGIN_URI_SCHEME: String = "cdvplugin"

        private val LOCAL_FILE_PROJECTION = arrayOf<String?>("_data")

        var jsThread: Thread? = null

        fun getUriType(uri: Uri): Int {
            assertNonRelative(uri)
            val scheme = uri.scheme
            if (ContentResolver.SCHEME_CONTENT.equals(scheme, ignoreCase = true)) {
                return URI_TYPE_CONTENT
            }
            if (ContentResolver.SCHEME_ANDROID_RESOURCE.equals(scheme, ignoreCase = true)) {
                return URI_TYPE_RESOURCE
            }
            if (ContentResolver.SCHEME_FILE.equals(scheme, ignoreCase = true)) {
                if (uri.path!!.startsWith("/android_asset/")) {
                    return URI_TYPE_ASSET
                }
                return URI_TYPE_FILE
            }
            if ("data".equals(scheme, ignoreCase = true)) {
                return URI_TYPE_DATA
            }
            if ("http".equals(scheme, ignoreCase = true)) {
                return URI_TYPE_HTTP
            }
            if ("https".equals(scheme, ignoreCase = true)) {
                return URI_TYPE_HTTPS
            }
            if (PLUGIN_URI_SCHEME.equals(scheme, ignoreCase = true)) {
                return URI_TYPE_PLUGIN
            }
            return URI_TYPE_UNKNOWN
        }

        private fun assertNonRelative(uri: Uri) {
            require(uri.isAbsolute) { "Relative URIs are not supported." }
        }
    }
}

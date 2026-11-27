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
package com.foxdebug.acode.runtime.webview

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.MediaStore
import android.util.Log
import android.webkit.ValueCallback
import android.webkit.WebChromeClient.FileChooserParams
import android.webkit.WebView
import androidx.core.content.FileProvider
import com.foxdebug.acode.runtime.Host
import com.foxdebug.acode.runtime.Service
import java.io.File
import java.io.IOException

internal class FileChooser(private val host: Host) {
    fun show(
        webView: WebView,
        filePathsCallback: ValueCallback<Array<Uri?>?>,
        fileChooserParams: FileChooserParams
    ): Boolean {
        val fileIntent = fileChooserParams.createIntent()

        // Check if multiple-select is specified
        var selectMultiple = false
        if (fileChooserParams.getMode() ==
            FileChooserParams.MODE_OPEN_MULTIPLE
        ) {
            selectMultiple = true
        }
        fileIntent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, selectMultiple)

        // Uses Intent.EXTRA_MIME_TYPES to pass multiple mime types.
        val acceptTypes = fileChooserParams.getAcceptTypes()
        if (acceptTypes.size > 1) {
            fileIntent.setType("*/*") // Accept all, filter mime types by Intent.EXTRA_MIME_TYPES.
            fileIntent.putExtra(Intent.EXTRA_MIME_TYPES, acceptTypes)
        }

        // Image from camera intent
        var tempUri: Uri? = null
        var captureIntent: Intent? = null
        if (fileChooserParams.isCaptureEnabled()) {
            captureIntent = Intent(MediaStore.ACTION_IMAGE_CAPTURE)
            val context = webView.getContext()
            if (context
                    .getPackageManager()
                    .hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY) &&
                captureIntent.resolveActivity(context.getPackageManager()) != null
            ) {
                try {
                    val tempFile = createTempFile(context)
                    Log.d(LOG_TAG, "Temporary photo capture file: " + tempFile)
                    tempUri = createUriForFile(context, tempFile)
                    Log.d(LOG_TAG, "Temporary photo capture URI: " + tempUri)
                    captureIntent.putExtra(MediaStore.EXTRA_OUTPUT, tempUri)
                } catch (e: IOException) {
                    Log.e(
                        LOG_TAG,
                        "Unable to create temporary file for photo capture",
                        e
                    )
                    captureIntent = null
                }
            } else {
                Log.w(LOG_TAG, "Device does not support photo capture")
                captureIntent = null
            }
        }
        val captureUri = tempUri

        // Chooser intent
        val chooserIntent = Intent.createChooser(fileIntent, null)
        if (captureIntent != null) {
            chooserIntent.putExtra(
                Intent.EXTRA_INITIAL_INTENTS, arrayOf<Intent>(
                    captureIntent,
                )
            )
        }

        try {
            Log.i(LOG_TAG, "Starting intent for file chooser")
            host.startActivityForResult(
                object : Service() {
                    public override fun onActivityResult(
                        requestCode: Int,
                        resultCode: Int,
                        intent: Intent?
                    ) {
                        // Handle result
                        var result: Array<Uri?>? = null
                        if (resultCode == Activity.RESULT_OK) {
                            val uris: MutableList<Uri?> = ArrayList<Uri?>()

                            if (intent != null && intent.getData() != null) {
                                // single file
                                Log.v(
                                    LOG_TAG,
                                    "Adding file (single): " + intent.getData()
                                )
                                uris.add(intent.getData())
                            } else if (captureUri != null) {
                                // camera
                                Log.v(LOG_TAG, "Adding camera capture: " + captureUri)
                                uris.add(captureUri)
                            } else if (intent != null && intent.getClipData() != null) {
                                // multiple files
                                val clipData = intent.getClipData()
                                val count = clipData!!.getItemCount()
                                for (i in 0..<count) {
                                    val uri = clipData.getItemAt(i).getUri()
                                    Log.v(LOG_TAG, "Adding file (multiple): " + uri)
                                    if (uri != null) {
                                        uris.add(uri)
                                    }
                                }
                            }

                            if (!uris.isEmpty()) {
                                Log.d(LOG_TAG, "Receive file chooser URL: " + uris)
                                result = uris.toTypedArray<Uri?>()
                            }
                        }
                        filePathsCallback.onReceiveValue(result)
                    }
                },
                chooserIntent,
                0
            )
        } catch (e: ActivityNotFoundException) {
            Log.w(
                LOG_TAG,
                "No activity found to handle file chooser intent.",
                e
            )
            filePathsCallback.onReceiveValue(null)
        }
        return true
    }

    @Throws(IOException::class)
    private fun createTempFile(context: Context): File {
        // Create an image file name
        return File.createTempFile("temp", ".jpg", context.getCacheDir())
    }

    @Throws(IOException::class)
    private fun createUriForFile(context: Context, tempFile: File): Uri? {
        val appId = context.getPackageName()
        return FileProvider.getUriForFile(context, appId + ".provider", tempFile)
    }

    companion object {
        private const val LOG_TAG = "AcodeFileChooser"
    }
}

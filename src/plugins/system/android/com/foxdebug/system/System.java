package com.foxdebug.system;

import static android.os.Build.VERSION.SDK_INT;

import java.nio.file.Files;
import java.nio.file.Paths;
import java.nio.file.StandardOpenOption;
import java.io.IOException;
import android.app.Activity;
import android.app.PendingIntent;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.content.res.Configuration;
import android.content.*;
import android.content.pm.*;
import java.util.*;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.ImageDecoder;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.Settings.Global;
import android.util.Base64;
import android.view.View;
import android.view.Window;
import android.view.WindowInsetsController;
import android.view.inputmethod.InputMethodManager;
import android.webkit.WebView;
import androidx.core.content.FileProvider;
import androidx.core.content.pm.ShortcutInfoCompat;
import androidx.core.content.pm.ShortcutManagerCompat;
import androidx.core.graphics.drawable.IconCompat;
import com.foxdebug.system.Ui.Theme;
import java.io.File;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.nio.ByteBuffer;
import java.nio.CharBuffer;
import java.nio.charset.Charset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.apache.cordova.CallbackContext;
import org.apache.cordova.CordovaInterface;
import org.apache.cordova.CordovaPlugin;
import org.apache.cordova.CordovaWebView;
import org.apache.cordova.PluginResult;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import android.content.Context;
import android.net.Uri;
import android.util.Log;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.IOException;
import android.webkit.MimeTypeMap;

// DocumentFile import (AndroidX library)
import androidx.documentfile.provider.DocumentFile;

// Java I/O imports
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.IOException;
import java.io.BufferedReader;
import java.io.InputStreamReader;

import android.os.Build;
import android.os.Environment;
import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.provider.Settings;

import androidx.core.content.ContextCompat;


import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.graphics.Canvas;
import android.util.TypedValue;

import android.provider.MediaStore;
import android.graphics.Bitmap;
import android.os.Build;
import android.graphics.ImageDecoder;



public class System extends CordovaPlugin {
    private static final String TAG = "SystemPlugin";

    private CallbackContext requestPermissionCallback;
    private Activity activity;
    private Context context;
    private int REQ_PERMISSIONS = 1;
    private int REQ_PERMISSION = 2;
    private int systemBarColor = 0xFF000000;
    private Theme theme;
    private CallbackContext intentHandler;
    private CordovaWebView webView;
    private String fileProviderAuthority;

    public void initialize(CordovaInterface cordova, CordovaWebView webView) {
        super.initialize(cordova, webView);
        this.context = cordova.getContext();
        this.activity = cordova.getActivity();
        this.webView = webView;
        this.activity.runOnUiThread(
            new Runnable() {
                @Override
                public void run() {
                    setNativeContextMenuDisabled(true);
                }
            }
        );

        // Set up global exception handler
        Thread.setDefaultUncaughtExceptionHandler(
            new Thread.UncaughtExceptionHandler() {
                @Override
                public void uncaughtException(Thread thread, Throwable ex) {
                    StringWriter sw = new StringWriter();
                    PrintWriter pw = new PrintWriter(sw);
                    ex.printStackTrace(pw);
                    String stackTrace = sw.toString();

                    String errorMsg = String.format(
                        "Uncaught Exception: %s\nStack trace: %s",
                        ex.getMessage(),
                        stackTrace
                    );

                    sendLogToJavaScript("error", errorMsg);

                    // rethrow to the default handler
                    Thread.getDefaultUncaughtExceptionHandler()
                        .uncaughtException(thread, ex);
                }
            }
        );
    }

    public boolean execute(
        String action,
        final JSONArray args,
        final CallbackContext callbackContext
    ) throws JSONException {
        final String arg1 = args.optString(0);
        final String arg2 = args.optString(1);
        final String arg3 = args.optString(2);
        final String arg4 = args.optString(3);
        final String arg5 = args.optString(4);
        final String arg6 = args.optString(5);

        switch (action) {
            case "get-webkit-info":
            case "file-action":
            case "is-powersave-mode":
            case "get-app-info":
            case "add-shortcut":
            case "remove-shortcut":
            case "pin-shortcut":
            case "get-android-version":
            case "request-permissions":
            case "request-permission":
            case "has-permission":
            case "open-in-browser":
            case "launch-app":
            case "get-global-setting":
            case "get-available-encodings":
            case "decode":
            case "encode":
            case "copyToUri":
            case "compare-file-text":
            case "compare-texts":
            case "pin-file-shortcut":
                break;
            case "get-configuration":
                getConfiguration(callbackContext);
                return true;
            case "set-input-type":
                setInputType(arg1);
                callbackContext.success();
                return true;
            case "set-native-context-menu-disabled":
                this.cordova.getActivity()
                    .runOnUiThread(
                        new Runnable() {
                            @Override
                            public void run() {
                                setNativeContextMenuDisabled(Boolean.parseBoolean(arg1));
                                callbackContext.success();
                            }
                        }
                    );
                return true;
            case "get-cordova-intent":
                getCordovaIntent(callbackContext);
                return true;
            case "set-intent-handler":
                setIntentHandler(callbackContext);
                return true;
            case "set-ui-theme":
                this.cordova.getActivity()
                    .runOnUiThread(
                        new Runnable() {
                            public void run() {
                                setUiTheme(arg1, args.optJSONObject(1), callbackContext);
                            }
                        }
                    );
                return true;
            case "clear-cache":
                this.cordova.getActivity()
                    .runOnUiThread(
                        new Runnable() {
                            public void run() {
                                clearCache(callbackContext);
                            }
                        }
                    );
                return true;
            case "fileExists":
                callbackContext.success(fileExists(args.getString(0), args.getString(1)) ? 1 : 0);
                return true;

            case "createSymlink":
                boolean success = createSymlink(args.getString(0), args.getString(1));
                callbackContext.success(success ? 1 : 0);
                return true;

            case "getNativeLibraryPath":
                callbackContext.success(getNativeLibraryPath());
                return true;

            case "getFilesDir":
                callbackContext.success(getFilesDir());
                return true;

            case "getParentPath":
                callbackContext.success(getParentPath(args.getString(0)));
                return true;

            case "listChildren":
                callbackContext.success(listChildren(args.getString(0)));
                return true;
            case "writeText":
                {
                    try {
                        String filePath = args.getString(0);
                        String content = args.getString(1);

                        Files.write(Paths.get(filePath),
                            Collections.singleton(content),
                            StandardOpenOption.CREATE,
                            StandardOpenOption.TRUNCATE_EXISTING);

                        callbackContext.success("File written successfully");
                    } catch (Exception e) {
                        callbackContext.error("Failed to write file: " + e.getMessage());
                    }
                    return true;
                }

            case "getArch":
                String arch;

                if (android.os.Build.VERSION.SDK_INT >= 21) {
                    arch = android.os.Build.SUPPORTED_ABIS[0];
                } else {
                    arch = android.os.Build.CPU_ABI;
                }

                callbackContext.success(arch);
                return true;

            case "requestStorageManager":
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    try {
                        Intent intent = new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION);
                        intent.setData(Uri.parse("package:" + context.getPackageName()));
                        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        context.startActivity(intent);
                        callbackContext.success("true");
                    } catch (Exception e) {
                        // Fallback to general settings if specific one fails
                        Intent intent = new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION);
                        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        context.startActivity(intent);
                        callbackContext.success("true");
                    }
                } else {
                    callbackContext.success("false"); // Not needed on Android < 11
                }
                return true;


            case "hasGrantedStorageManager":
                boolean granted;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    granted = Environment.isExternalStorageManager();
                } else {
                    // Fallback for Android 10 and below
                    granted = ContextCompat.checkSelfPermission(
                        context,
                        Manifest.permission.READ_EXTERNAL_STORAGE
                    ) == PackageManager.PERMISSION_GRANTED;
                }
                callbackContext.success(String.valueOf(granted));
                return true;

            case "isManageExternalStorageDeclared":
                PackageManager pm = context.getPackageManager();
                try {
                    PackageInfo info = pm.getPackageInfo(context.getPackageName(), PackageManager.GET_PERMISSIONS);
                    String[] permissions = info.requestedPermissions;
                    String isDeclared = "false";

                    if (permissions != null) {
                        for (String perm: permissions) {
                            if (perm.equals("android.permission.MANAGE_EXTERNAL_STORAGE")) {
                                isDeclared = "true";
                                break;
                            }
                        }
                    }
                    callbackContext.success(isDeclared);

                } catch (PackageManager.NameNotFoundException e) {
                    e.printStackTrace();
                    callbackContext.error(e.toString());
                }

                return true;
            case "mkdirs":
                if (new File(args.getString(0)).mkdirs()) {
                    callbackContext.success();
                } else {
                    callbackContext.error("mkdirs failed");
                }
                return true;
            case "deleteFile":
                if (new File(args.getString(0)).delete()) {
                    callbackContext.success();
                } else {
                    callbackContext.error("delete failed");
                }
                return true;
            case "setExec":
                if (new File(args.getString(0)).setExecutable(Boolean.parseBoolean(args.getString(1)))) {
                    callbackContext.success();
                } else {
                    callbackContext.error("set exec failed");
                }

                return true;
            default:
                return false;
        }

        cordova
            .getThreadPool()
            .execute(
                new Runnable() {
                    public void run() {
                        switch (action) {
                            case "copyToUri":
                                try {
                                    //srcUri is a file
                                    Uri srcUri = Uri.parse(args.getString(0));

                                    //destUri is a directory
                                    Uri destUri = Uri.parse(args.getString(1));

                                    //create a file named this into the dest Directory and copy the srcUri into it
                                    String fileName = args.getString(2);

                                    InputStream in = null;
                                    OutputStream out = null;
                                    try {
                                        // Open input stream from the source URI
                                        if ("file".equalsIgnoreCase(srcUri.getScheme())) {
                                            File file = new File(srcUri.getPath()); in = new FileInputStream(file);
                                        } else { in = context.getContentResolver().openInputStream(srcUri);
                                        }

                                        // Create the destination file using DocumentFile for better URI handling
                                        DocumentFile destFile = null;

                                        if ("file".equalsIgnoreCase(destUri.getScheme())) {
                                            // Handle file:// scheme using DocumentFile
                                            File destDir = new File(destUri.getPath());
                                            if (!destDir.exists()) {
                                                destDir.mkdirs(); // Create directory if it doesn't exist
                                            }
                                            DocumentFile destDocDir = DocumentFile.fromFile(destDir);

                                            // Check if file already exists and delete it
                                            DocumentFile existingFile = destDocDir.findFile(fileName);
                                            if (existingFile != null && existingFile.exists()) {
                                                existingFile.delete();
                                            }

                                            // Create new file
                                            String mimeType = getMimeTypeFromExtension(fileName);
                                            destFile = destDocDir.createFile(mimeType, fileName);
                                        } else {
                                            // Handle content:// scheme using DocumentFile
                                            DocumentFile destDocDir = DocumentFile.fromTreeUri(context, destUri);

                                            if (destDocDir == null || !destDocDir.exists() || !destDocDir.isDirectory()) {
                                                callbackContext.error("Destination directory does not exist or is not accessible");
                                                return;
                                            }

                                            // Check if file already exists and delete it
                                            DocumentFile existingFile = destDocDir.findFile(fileName);
                                            if (existingFile != null && existingFile.exists()) {
                                                existingFile.delete();
                                            }

                                            // Create new file
                                            String mimeType = getMimeTypeFromExtension(fileName);
                                            destFile = destDocDir.createFile(mimeType, fileName);
                                        }

                                        if (destFile == null || !destFile.exists()) {
                                            callbackContext.error("Failed to create destination file");
                                            return;
                                        }

                                        // Open output stream to the created file
                                        out = context.getContentResolver().openOutputStream(destFile.getUri());

                                        if ( in == null || out == null) {
                                            callbackContext.error("uri streams are null");
                                            return;
                                        }

                                        // Copy stream
                                        byte[] buffer = new byte[8192];
                                        int len;
                                        while ((len = in .read(buffer)) > 0) {
                                            out.write(buffer, 0, len);
                                        }

                                        out.flush();
                                        callbackContext.success();
                                    } catch (IOException e) {
                                        e.printStackTrace();
                                        callbackContext.error(e.toString());
                                    } finally {
                                        try {
                                            if ( in != null) in .close();
                                            if (out != null) out.close();
                                        } catch (IOException e) {
                                            e.printStackTrace();
                                            callbackContext.error(e.toString());
                                        }
                                    }
                                } catch (Exception e) {
                                    e.printStackTrace();
                                    callbackContext.error(e.toString());
                                }
                                break;
                            case "get-webkit-info":
                                getWebkitInfo(callbackContext);
                                break;
                            case "file-action":
                                fileAction(arg1, arg2, arg3, arg4, callbackContext);
                                break;
                            case "is-powersave-mode":
                                isPowerSaveMode(callbackContext);
                                break;
                            case "get-app-info":
                                getAppInfo(callbackContext);
                                break;
                            case "pin-file-shortcut":
                                pinFileShortcut(args.optJSONObject(0), callbackContext);
                                break;
                            case "add-shortcut":
                                addShortcut(
                                    arg1,
                                    arg2,
                                    arg3,
                                    arg4,
                                    arg5,
                                    arg6,
                                    callbackContext
                                );
                                break;
                            case "remove-shortcut":
                                removeShortcut(arg1, callbackContext);
                                break;
                            case "pin-shortcut":
                                pinShortcut(arg1, callbackContext);
                                break;
                            case "get-android-version":
                                getAndroidVersion(callbackContext);
                                break;
                            case "request-permissions":
                                requestPermissions(args.optJSONArray(0), callbackContext);
                                break;
                            case "request-permission":
                                requestPermission(arg1, callbackContext);
                                break;
                            case "has-permission":
                                hasPermission(arg1, callbackContext);
                                break;
                            case "open-in-browser":
                                openInBrowser(arg1, callbackContext);
                                break;
                            case "launch-app":
                                launchApp(arg1, arg2, arg3, callbackContext);
                                break;
                            case "get-global-setting":
                                getGlobalSetting(arg1, callbackContext);
                                break;
                            case "get-available-encodings":
                                getAvailableEncodings(callbackContext);
                                break;
                            case "decode":
                                decode(arg1, arg2, callbackContext);
                                break;
                            case "encode":
                                encode(arg1, arg2, callbackContext);
                                break;
                            case "compare-file-text":
                                compareFileText(arg1, arg2, arg3, callbackContext);
                                break;
                            case "compare-texts":
                                compareTexts(arg1, arg2, callbackContext);
                                break;
                            default:
                                break;
                        }
                    }
                }
            );

        return true;
    }

    private void sendLogToJavaScript(String level, String message) {
        final String js =
            "window.log('" + level + "', " + JSONObject.quote(message) + ");";
        cordova
            .getActivity()
            .runOnUiThread(
                new Runnable() {
                    @Override
                    public void run() {
                        webView.loadUrl("javascript:" + js);
                    }
                }
            );
    }

    // Helper method to determine MIME type using Android's built-in MimeTypeMap
    private String getMimeTypeFromExtension(String fileName) {
        String extension = "";
        int lastDotIndex = fileName.lastIndexOf('.');
        if (lastDotIndex > 0 && lastDotIndex < fileName.length() - 1) {
            extension = fileName.substring(lastDotIndex + 1).toLowerCase();
        }

        String mimeType = MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension);
        return mimeType != null ? mimeType : "application/octet-stream";
    }

    private void getConfiguration(CallbackContext callback) {
        try {
            JSONObject result = new JSONObject();
            Configuration config = context.getResources().getConfiguration();
            InputMethodManager imm = (InputMethodManager) context.getSystemService(
                Context.INPUT_METHOD_SERVICE
            );
            Method method =
                InputMethodManager.class.getMethod("getInputMethodWindowVisibleHeight");

            result.put("isAcceptingText", imm.isAcceptingText());
            result.put("keyboardHeight", method.invoke(imm));
            result.put("locale", config.locale.toString());
            result.put("fontScale", config.fontScale);
            result.put("keyboard", config.keyboard);
            result.put("keyboardHidden", config.keyboardHidden);
            result.put("hardKeyboardHidden", config.hardKeyboardHidden);
            result.put("navigationHidden", config.navigationHidden);
            result.put("navigation", config.navigation);
            result.put("orientation", config.orientation);
            callback.success(result);
        } catch (
            JSONException |
            NoSuchMethodException |
            IllegalAccessException |
            InvocationTargetException error
        ) {
            callback.error(error.toString());
        }
    }

    private void decode(
        String content, // base64 encoded string
        String charSetName,
        CallbackContext callback
    ) {
        try {
            byte[] bytes = Base64.decode(content, Base64.DEFAULT);

            if (Charset.isSupported(charSetName) == false) {
                callback.error("Charset not supported: " + charSetName);
                return;
            }

            Charset charSet = Charset.forName(charSetName);
            CharBuffer charBuffer = charSet.decode(ByteBuffer.wrap(bytes));
            String result = String.valueOf(charBuffer);
            callback.success(result);
        } catch (Exception e) {
            callback.error(e.toString());
        }
    }

    private void encode(
        String content, // string to encode
        String charSetName,
        CallbackContext callback
    ) {
        try {
            if (Charset.isSupported(charSetName) == false) {
                callback.error("Charset not supported: " + charSetName);
                return;
            }

            Charset charSet = Charset.forName(charSetName);
            ByteBuffer byteBuffer = charSet.encode(content);
            byte[] bytes = new byte[byteBuffer.remaining()];
            byteBuffer.get(bytes);
            callback.success(bytes);
        } catch (Exception e) {
            callback.error(e.toString());
        }
    }

    /**
     * Compares file content with provided text.
     * This method runs in a background thread to avoid blocking the UI.
     * 
     * @param fileUri The URI of the file to read (file:// or content://)
     * @param encoding The character encoding to use when reading the file
     * @param currentText The text to compare against the file content
     * @param callback Returns 1 if texts are different, 0 if same
     */
    private void compareFileText(
        String fileUri,
        String encoding,
        String currentText,
        CallbackContext callback
    ) {
        try {
            if (fileUri == null || fileUri.isEmpty()) {
                callback.error("File URI is required");
                return;
            }

            if (encoding == null || encoding.isEmpty()) {
                encoding = "UTF-8";
            }

            if (!Charset.isSupported(encoding)) {
                callback.error("Charset not supported: " + encoding);
                return;
            }

            Uri uri = Uri.parse(fileUri);
            Charset charset = Charset.forName(encoding);
            String fileContent;

            // Handle file:// URIs
            if ("file".equalsIgnoreCase(uri.getScheme())) {
                File file = new File(uri.getPath());
                
                // Validate file
                if (!file.exists()) {
                    callback.error("File does not exist");
                    return;
                }
                if (!file.isFile()) {
                    callback.error("Path is not a file");
                    return;
                }
                if (!file.canRead()) {
                    callback.error("File is not readable");
                    return;
                }

                Path path = file.toPath();
                fileContent = new String(Files.readAllBytes(path), charset);

            } else if ("content".equalsIgnoreCase(uri.getScheme())) {
                // Handle content:// URIs (including SAF tree URIs)
                InputStream inputStream = null;
                try {
                    String uriString = fileUri;
                    Uri resolvedUri = uri;
                    
                    // Check if this is a SAF tree URI with :: separator
                    if (uriString.contains("::")) {
                        try {
                            // Split into tree URI and document ID
                            String[] parts = uriString.split("::", 2);
                            String treeUriStr = parts[0];
                            String docId = parts[1];
                            
                            // Build document URI directly from tree URI and document ID
                            Uri treeUri = Uri.parse(treeUriStr);
                            resolvedUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, docId);
                        } catch (Exception e) {
                            callback.error("SAF_FALLBACK: Invalid SAF URI format - " + e.getMessage());
                            return;
                        }
                    }
                    
                    // Try to open the resolved URI
                    inputStream = context.getContentResolver().openInputStream(resolvedUri);
                    
                    if (inputStream == null) {
                        callback.error("Cannot open file");
                        return;
                    }

                    StringBuilder sb = new StringBuilder();
                    try (BufferedReader reader = new BufferedReader(
                            new InputStreamReader(inputStream, charset))) {
                        char[] buffer = new char[8192];
                        int charsRead;
                        while ((charsRead = reader.read(buffer)) != -1) {
                            sb.append(buffer, 0, charsRead);
                        }
                    }
                    fileContent = sb.toString();
                    
                } finally {
                    if (inputStream != null) {
                        try {
                            inputStream.close();
                        } catch (IOException closeError) {
                            Log.w(TAG, "Failed to close input stream while reading file.", closeError);
                        }
                    }
                }
            } else {
                callback.error("Unsupported URI scheme: " + uri.getScheme());
                return;
            }

            // check length first 
            if (fileContent.length() != currentText.length()) {
                callback.success(1); // Changed
                return;
            }

            // Full comparison
            if (fileContent.equals(currentText)) {
                callback.success(0); // Not changed
            } else {
                callback.success(1); // Changed
            }

        } catch (Exception e) {
            callback.error(e.toString());
        }
    }

    /**
     * Compares two text strings.
     * This method runs in a background thread to avoid blocking the UI
     * for large string comparisons.
     * 
     * @param text1 First text to compare
     * @param text2 Second text to compare
     * @param callback Returns 1 if texts are different, 0 if same
     */
    private void compareTexts(
        String text1,
        String text2,
        CallbackContext callback
    ) {
        try {
            if (text1 == null) text1 = "";
            if (text2 == null) text2 = "";

            // check length first
            if (text1.length() != text2.length()) {
                callback.success(1); // Changed
                return;
            }

            // Full comparison
            if (text1.equals(text2)) {
                callback.success(0); // Not changed
            } else {
                callback.success(1); // Changed
            }

        } catch (Exception e) {
            callback.error(e.toString());
        }
    }

    private void getAvailableEncodings(CallbackContext callback) {
        try {
            Map < String, Charset > charsets = Charset.availableCharsets();
            JSONObject result = new JSONObject();
            for (Map.Entry < String, Charset > entry: charsets.entrySet()) {
                JSONObject obj = new JSONObject();
                Charset charset = entry.getValue();
                obj.put("label", charset.displayName());
                obj.put("aliases", new JSONArray(charset.aliases()));
                obj.put("name", charset.name());
                result.put(charset.name(), obj);
            }
            callback.success(result);
        } catch (Exception e) {
            callback.error(e.toString());
        }
    }

    private void requestPermissions(JSONArray arr, CallbackContext callback) {
        try {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
                int[] res = new int[arr.length()];
                for (int i = 0; i < res.length; ++i) {
                    res[i] = 1;
                }
                callback.success(1);
                return;
            }

            String[] permissions = checkPermissions(arr);

            if (permissions.length > 0) {
                requestPermissionCallback = callback;
                cordova.requestPermissions(this, REQ_PERMISSIONS, permissions);
                return;
            }
            callback.success(new JSONArray());
        } catch (Exception e) {
            callback.error(e.toString());
        }
    }

    private void requestPermission(String permission, CallbackContext callback) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            callback.success(1);
            return;
        }

        if (permission != null || !permission.equals("")) {
            if (!cordova.hasPermission(permission)) {
                requestPermissionCallback = callback;
                cordova.requestPermission(this, REQ_PERMISSION, permission);
                return;
            }

            callback.success(1);
            return;
        }

        callback.error("No permission passed to request.");
    }

    private void hasPermission(String permission, CallbackContext callback) {
        if (permission != null || !permission.equals("")) {
            int res = 0;
            if (cordova.hasPermission(permission)) {
                res = 1;
            }

            callback.success(res);
            return;
        }
        callback.error("No permission passed to check.");
    }

    public boolean fileExists(String path, String countSymlinks) {
        boolean followSymlinks = !Boolean.parseBoolean(countSymlinks);
        File file = new File(path);

        // Android < O does not implement File#toPath(), fall back to legacy checks
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            if (!file.exists()) return false;
            if (followSymlinks) {
                try {
                    // If canonical and absolute paths differ, it's a symlink
                    return file.getCanonicalPath().equals(file.getAbsolutePath());
                } catch (IOException ignored) {
                    return false;
                }
            }
            return true;
        }

        Path p = file.toPath();
        try {
            if (followSymlinks) {
                return Files.exists(p) && !Files.isSymbolicLink(p);
            } else {
                return Files.exists(p, LinkOption.NOFOLLOW_LINKS);
            }
        } catch (Exception e) {
            return false;
        }
    }

    public boolean createSymlink(String target, String linkPath) {
        try {
            Process process = Runtime.getRuntime().exec(new String[] {
                "ln",
                "-s",
                target,
                linkPath
            });
            return process.waitFor() == 0;
        } catch (Exception e) {
            return false;
        }
    }

    public String getNativeLibraryPath() {
        ApplicationInfo appInfo = context.getApplicationInfo();
        return appInfo.nativeLibraryDir;
    }

    public String getFilesDir() {
        return context.getFilesDir().getAbsolutePath();
    }

    public String getParentPath(String path) {
        File file = new File(path);
        File parent = file.getParentFile();
        return parent != null ? parent.getAbsolutePath() : null;
    }

    public JSONArray listChildren(String path) throws JSONException {
        File dir = new File(path);
        JSONArray result = new JSONArray();
        if (dir.exists() && dir.isDirectory()) {
            File[] files = dir.listFiles();
            if (files != null) {
                for (File file: files) {
                    result.put(file.getAbsolutePath());
                }
            }
        }
        return result;
    }

    public void onRequestPermissionResult(
        int code,
        String[] permissions,
        int[] resCodes
    ) {
        if (requestPermissionCallback == null) return;

        if (code == REQ_PERMISSIONS) {
            JSONArray resAr = new JSONArray();
            for (int res: resCodes) {
                if (res == PackageManager.PERMISSION_DENIED) {
                    resAr.put(0);
                }
                resAr.put(1);
            }

            requestPermissionCallback.success(resAr);
            requestPermissionCallback = null;
            return;
        }

        if (
            resCodes.length >= 1 && resCodes[0] == PackageManager.PERMISSION_DENIED
        ) {
            requestPermissionCallback.success(0);
            requestPermissionCallback = null;
            return;
        }
        requestPermissionCallback.success(1);
        requestPermissionCallback = null;
        return;
    }

    private String[] checkPermissions(JSONArray arr) throws Exception {
        List < String > list = new ArrayList < String > ();
        for (int i = 0; i < arr.length(); i++) {
            try {
                String permission = arr.getString(i);
                if (permission == null || permission.equals("")) {
                    throw new Exception("Permission cannot be null or empty");
                }
                if (!cordova.hasPermission(permission)) {
                    list.add(permission);
                }
            } catch (JSONException e) {
                Log.w(TAG, "Invalid permission entry at index " + i, e);
            }
        }

        String[] res = new String[list.size()];
        return list.toArray(res);
    }

    private void getAndroidVersion(CallbackContext callback) {
        callback.success(Build.VERSION.SDK_INT);
    }

    private void getWebkitInfo(CallbackContext callback) {
        PackageInfo info = null;
        JSONObject res = new JSONObject();

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                info = WebView.getCurrentWebViewPackage();
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                Class webViewFactory = Class.forName("android.webkit.WebViewFactory");
                Method method = webViewFactory.getMethod("getLoadedPackageInfo");
                info = (PackageInfo) method.invoke(null);
            } else {
                PackageManager packageManager = activity.getPackageManager();

                try {
                    info = packageManager.getPackageInfo("com.google.android.webview", 0);
                } catch (PackageManager.NameNotFoundException e) {
                    callback.error("Package not found");
                }

                return;
            }

            res.put("packageName", info.packageName);
            res.put("versionName", info.versionName);
            res.put("versionCode", info.versionCode);

            callback.success(res);
        } catch (
            JSONException |
            InvocationTargetException |
            ClassNotFoundException |
            NoSuchMethodException |
            IllegalAccessException e
        ) {
            callback.error(
                "Cannot determine current WebView engine. (" + e.getMessage() + ")"
            );

            return;
        }
    }

    private void isPowerSaveMode(CallbackContext callback) {
        PowerManager powerManager = (PowerManager) context.getSystemService(
            Context.POWER_SERVICE
        );
        boolean powerSaveMode = powerManager.isPowerSaveMode();

        callback.success(powerSaveMode ? 1 : 0);
    }

    private void pinFileShortcut(JSONObject shortcutJson, CallbackContext callback) {
        if (shortcutJson == null) {
            callback.error("Invalid shortcut data");
            return;
        }

        String id = shortcutJson.optString("id", "");
        String label = shortcutJson.optString("label", "");
        String description = shortcutJson.optString("description", label);
        String iconSrc = shortcutJson.optString("icon", "");
        String uriString = shortcutJson.optString("uri", "");

        if (id.isEmpty() || label.isEmpty() || uriString.isEmpty()) {
            callback.error("Missing required shortcut fields");
            return;
        }

        if (!ShortcutManagerCompat.isRequestPinShortcutSupported(context)) {
            callback.error("Pin shortcut not supported on this launcher");
            return;
        }

        try {
            Uri dataUri = Uri.parse(uriString);
            String packageName = context.getPackageName();
            PackageManager pm = context.getPackageManager();

            Intent launchIntent = pm.getLaunchIntentForPackage(packageName);
            if (launchIntent == null) {
                callback.error("Launch intent not found for package: " + packageName);
                return;
            }

            ComponentName componentName = launchIntent.getComponent();
            if (componentName == null) {
                callback.error("ComponentName is null");
                return;
            }

            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setComponent(componentName);
            intent.setData(dataUri);
            intent.putExtra("acodeFileUri", uriString);

            IconCompat icon;

            if (iconSrc != null && !iconSrc.isEmpty()) {
                try {
                    Uri iconUri = Uri.parse(iconSrc);
                    Bitmap bitmap;

                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                        // API 28+
                        ImageDecoder.Source source =
                                ImageDecoder.createSource(
                                        context.getContentResolver(),
                                        iconUri
                                );
                        bitmap = ImageDecoder.decodeBitmap(source);
                    } else {
                        // Below API 28
                        bitmap = MediaStore.Images.Media.getBitmap(
                                context.getContentResolver(),
                                iconUri
                        );
                    }

                    icon = IconCompat.createWithBitmap(bitmap);

                } catch (Exception e) {
                    icon = getFileShortcutIcon(label);
                }
            } else {
                icon = getFileShortcutIcon(label);
            }

            ShortcutInfoCompat shortcut = new ShortcutInfoCompat.Builder(context, id)
                .setShortLabel(label)
                .setLongLabel(
                    description != null && !description.isEmpty() ? description : label
                )
                .setIcon(icon)
                .setIntent(intent)
                .build();

            ShortcutManagerCompat.pushDynamicShortcut(context, shortcut);

            boolean requested = ShortcutManagerCompat.requestPinShortcut(
                context,
                shortcut,
                null
            );

            if (!requested) {
                callback.error("Failed to request pin shortcut");
                return;
            }

            callback.success();
        } catch (Exception e) {
            callback.error(e.toString());
        }
    }

    private IconCompat getFileShortcutIcon(String filename) {
        Bitmap fallback = createFileShortcutBitmap(filename);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            return IconCompat.createWithAdaptiveBitmap(fallback);
        }
        return IconCompat.createWithBitmap(fallback);
    }

    private Bitmap createFileShortcutBitmap(String filename) {
        final float baseSizeDp = 72f;
        float sizePx = TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP,
            baseSizeDp,
            context.getResources().getDisplayMetrics()
        );
        if (sizePx <= 0) {
            sizePx = baseSizeDp;
        }
        int size = Math.round(sizePx);
        Bitmap bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.DITHER_FLAG | Paint.FILTER_BITMAP_FLAG);

        int backgroundColor = pickShortcutColor(filename);
        paint.setColor(backgroundColor);
        float radius = size * 0.24f;
        RectF bounds = new RectF(0, 0, size, size);
        canvas.drawRoundRect(bounds, radius, radius, paint);

        paint.setColor(Color.WHITE);
        paint.setTextAlign(Paint.Align.CENTER);
        paint.setTypeface(Typeface.create("sans-serif-medium", Typeface.BOLD));

        String label = getShortcutLabel(filename);
        float textLength = Math.max(1, label.length());
        float factor = textLength > 4 ? 0.22f : textLength > 3 ? 0.26f : 0.34f;
        paint.setTextSize(size * factor);
        Paint.FontMetrics metrics = paint.getFontMetrics();
        float baseline = (size - metrics.bottom - metrics.top) / 2f;
        canvas.drawText(label, size / 2f, baseline, paint);

        return bitmap;
    }

    private String getFileExtension(String filename) {
        if (filename == null) return "";
        int dot = filename.lastIndexOf('.');
        if (dot < 0 || dot == filename.length() - 1) return "";
        return filename.substring(dot + 1).toLowerCase(Locale.getDefault());
    }

    private String getShortcutLabel(String filename) {
        String ext = getFileExtension(filename);
        if (!ext.isEmpty()) {
            switch (ext) {
                case "js":
                case "jsx":
                    return "JS";
                case "ts":
                case "tsx":
                    return "TS";
                case "md":
                case "markdown":
                    return "MD";
                case "json":
                    return "JSON";
                case "html":
                case "htm":
                    return "HTML";
                case "css":
                    return "CSS";
                case "java":
                    return "JAVA";
                case "kt":
                case "kts":
                    return "KOT";
                case "py":
                    return "PY";
                case "rb":
                    return "RB";
                case "c":
                    return "C";
                case "cpp":
                case "cc":
                case "cxx":
                    return "CPP";
                case "h":
                case "hpp":
                    return "HDR";
                case "go":
                    return "GO";
                case "rs":
                    return "RS";
                case "php":
                    return "PHP";
                case "xml":
                    return "XML";
                case "yml":
                case "yaml":
                    return "YML";
                case "txt":
                    return "TXT";
                case "sh":
                case "bash":
                    return "SH";
                default:
                    String label = ext.replaceAll("[^A-Za-z0-9]", "");
                    if (label.isEmpty()) label = ext;
                    if (label.length() > 4) {
                        label = label.substring(0, 4);
                    }
                    return label.toUpperCase(Locale.getDefault());
            }
        }

        if (filename != null && !filename.trim().isEmpty()) {
            String cleaned = filename.replaceAll("[^A-Za-z0-9]", "");
            if (!cleaned.isEmpty()) {
                if (cleaned.length() > 3) cleaned = cleaned.substring(0, 3);
                return cleaned.toUpperCase(Locale.getDefault());
            }
            return filename.substring(0, 1).toUpperCase(Locale.getDefault());
        }

        return "FILE";
    }

    private int pickShortcutColor(String filename) {
        String ext = getFileExtension(filename);
        switch (ext) {
            case "js":
            case "jsx":
                return 0xFFF7DF1E;
            case "ts":
            case "tsx":
                return 0xFF3178C6;
            case "md":
            case "markdown":
                return 0xFF546E7A;
            case "json":
                return 0xFF4CAF50;
            case "html":
            case "htm":
                return 0xFFF4511E;
            case "css":
                return 0xFF2962FF;
            case "java":
                return 0xFFEC6F2D;
            case "kt":
            case "kts":
                return 0xFF7F52FF;
            case "py":
                return 0xFF306998;
            case "rb":
                return 0xFFCC342D;
            case "c":
                return 0xFF546E7A;
            case "cpp":
            case "cc":
            case "cxx":
                return 0xFF00599C;
            case "h":
            case "hpp":
                return 0xFF8D6E63;
            case "go":
                return 0xFF00ADD8;
            case "rs":
                return 0xFFB7410E;
            case "php":
                return 0xFF8892BF;
            case "xml":
                return 0xFF5C6BC0;
            case "yml":
            case "yaml":
                return 0xFF757575;
            case "txt":
                return 0xFF546E7A;
            case "sh":
            case "bash":
                return 0xFF388E3C;
            default:
                final int[] colors = new int[] {
                    0xFF1E88E5,
                    0xFF6D4C41,
                    0xFF00897B,
                    0xFF8E24AA,
                    0xFF3949AB,
                    0xFF039BE5,
                    0xFFD81B60,
                    0xFF43A047
                };
                String key = ext.isEmpty()
                    ? (filename == null ? "file" : filename)
                    : ext;
                int hash = Math.abs(key.hashCode());
                return colors[hash % colors.length];
        }
    }

    private void fileAction(
        String fileURI,
        String filename,
        String action,
        String mimeType,
        CallbackContext callback
    ) {
        Activity activity = this.activity;
        Context context = this.context;
        Uri uri = this.getContentProviderUri(fileURI, filename);
        if (uri == null) {
            callback.error("Unable to access file for action " + action);
            return;
        }
        try {
            Intent intent = new Intent(action);

            if (mimeType.equals("")) {
                mimeType = "text/plain";
            }

            mimeType = resolveMimeType(mimeType, uri, filename);

            String clipLabel = null;
            if (filename != null && !filename.isEmpty()) {
                clipLabel = new File(filename).getName();
            }
            if (clipLabel == null || clipLabel.isEmpty()) {
                clipLabel = uri.getLastPathSegment();
            }
            if (clipLabel == null || clipLabel.isEmpty()) {
                clipLabel = "shared-file";
            }
            if (action.equals(Intent.ACTION_SEND)) {
                intent.setType(mimeType);
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                intent.setClipData(
                    ClipData.newUri(
                        context.getContentResolver(),
                        clipLabel,
                        uri
                    )
                );
                intent.putExtra(Intent.EXTRA_STREAM, uri);
                intent.putExtra(Intent.EXTRA_TITLE, clipLabel);
                intent.putExtra(Intent.EXTRA_SUBJECT, clipLabel);
                if (filename != null && !filename.isEmpty()) {
                    intent.putExtra(Intent.EXTRA_TEXT, filename);
                }
            } else {
                int flags =
                    Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION |
                    Intent.FLAG_GRANT_READ_URI_PERMISSION;

                if (action.equals(Intent.ACTION_EDIT)) {
                    flags |= Intent.FLAG_GRANT_WRITE_URI_PERMISSION;
                }

                intent.setFlags(flags);
                intent.setDataAndType(uri, mimeType);
                intent.setClipData(
                    ClipData.newUri(
                        context.getContentResolver(),
                        clipLabel,
                        uri
                    )
                );
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                if (!clipLabel.equals("shared-file")) {
                    intent.putExtra(Intent.EXTRA_TITLE, clipLabel);
                }
                if (action.equals(Intent.ACTION_EDIT)) {
                    intent.putExtra(Intent.EXTRA_STREAM, uri);
                }
            }

            int permissionFlags = Intent.FLAG_GRANT_READ_URI_PERMISSION;
            if (action.equals(Intent.ACTION_EDIT)) {
                permissionFlags |= Intent.FLAG_GRANT_WRITE_URI_PERMISSION;
            }
            grantUriPermissions(intent, uri, permissionFlags);

            if (action.equals(Intent.ACTION_SEND)) {
                Intent chooserIntent = Intent.createChooser(intent, null);
                chooserIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                activity.startActivity(chooserIntent);
            } else if (action.equals(Intent.ACTION_EDIT) || action.equals(Intent.ACTION_VIEW)) {
                Intent chooserIntent = Intent.createChooser(intent, null);
                chooserIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                if (action.equals(Intent.ACTION_EDIT)) {
                    chooserIntent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                }
                activity.startActivity(chooserIntent);
            } else {
                activity.startActivity(intent);
            }
            callback.success(uri.toString());
        } catch (Exception e) {
            callback.error(e.getMessage());
        }
    }

    private void getAppInfo(CallbackContext callback) {
        JSONObject res = new JSONObject();
        try {
            PackageManager pm = activity.getPackageManager();
            PackageInfo pInfo = pm.getPackageInfo(context.getPackageName(), 0);
            ApplicationInfo appInfo = context.getApplicationInfo();
            int isDebuggable = appInfo.flags & ApplicationInfo.FLAG_DEBUGGABLE;

            res.put("firstInstallTime", pInfo.firstInstallTime);
            res.put("lastUpdateTime", pInfo.lastUpdateTime);
            res.put("label", appInfo.loadLabel(pm).toString());
            res.put("packageName", pInfo.packageName);
            res.put("versionName", pInfo.versionName);
            res.put("versionCode", pInfo.getLongVersionCode());
            res.put("isDebuggable", isDebuggable);

            callback.success(res);
        } catch (JSONException e) {
            callback.error(e.getMessage());
        } catch (Exception e) {
            callback.error(e.getMessage());
        }
    }

    private void openInBrowser(String src, CallbackContext callback) {
        Intent browserIntent = new Intent(Intent.ACTION_VIEW, Uri.parse(src));
        activity.startActivity(browserIntent);
    }

    private void launchApp(
        String appId,
        String className,
        String data,
        CallbackContext callback
    ) {
        if (appId == null || appId.equals("")) {
            callback.error("No package name provided.");
            return;
        }

        if (className == null || className.equals("")) {
            callback.error("No activity class name provided.");
            return;
        }

        try {
            Intent intent = new Intent(Intent.ACTION_MAIN);
            intent.addCategory(Intent.CATEGORY_LAUNCHER);
            intent.setPackage(appId);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

            if (data != null && !data.equals("")) {
                intent.putExtra("acode_data", data);
            }

            intent.setClassName(appId, className);
            activity.startActivity(intent);
            callback.success("Launched " + appId);
        } catch (Exception e) {
            callback.error(e.toString());
            return;
        }



    }


    private void addShortcut(
        String id,
        String label,
        String description,
        String iconSrc,
        String action,
        String data,
        CallbackContext callback
    ) {
        try {
            Intent intent;
            ImageDecoder.Source imgSrc;
            Bitmap bitmap;
            IconCompat icon;

            imgSrc = ImageDecoder.createSource(
                context.getContentResolver(),
                Uri.parse(iconSrc)
            );
            bitmap = ImageDecoder.decodeBitmap(imgSrc);
            icon = IconCompat.createWithBitmap(bitmap);
            intent = activity
                .getPackageManager()
                .getLaunchIntentForPackage(activity.getPackageName());
            intent.putExtra("action", action);
            intent.putExtra("data", data);

            ShortcutInfoCompat shortcut = new ShortcutInfoCompat.Builder(context, id)
                .setShortLabel(label)
                .setLongLabel(description)
                .setIcon(icon)
                .setIntent(intent)
                .build();

            ShortcutManagerCompat.pushDynamicShortcut(context, shortcut);
            callback.success();
        } catch (Exception e) {
            callback.error(e.toString());
        }
    }

    private void pinShortcut(String id, CallbackContext callback) {
        ShortcutManager shortcutManager = context.getSystemService(
            ShortcutManager.class
        );

        if (shortcutManager.isRequestPinShortcutSupported()) {
            ShortcutInfo pinShortcutInfo = new ShortcutInfo.Builder(
                context,
                id
            ).build();

            Intent pinnedShortcutCallbackIntent =
                shortcutManager.createShortcutResultIntent(pinShortcutInfo);

            PendingIntent successCallback = PendingIntent.getBroadcast(
                context,
                0,
                pinnedShortcutCallbackIntent,
                PendingIntent.FLAG_IMMUTABLE
            );

            shortcutManager.requestPinShortcut(
                pinShortcutInfo,
                successCallback.getIntentSender()
            );

            callback.success();
            return;
        }

        callback.error("Not supported");
    }

    private void removeShortcut(String id, CallbackContext callback) {
        try {
            List < String > list = new ArrayList < String > ();
            list.add(id);
            ShortcutManagerCompat.removeDynamicShortcuts(context, list);
            callback.success();
        } catch (Exception e) {
            callback.error(e.toString());
        }
    }

    private void setUiTheme(
        final String systemBarColor,
        final JSONObject scheme,
        final CallbackContext callback
    ) {
        this.systemBarColor = Color.parseColor(systemBarColor);
        this.theme = new Theme(scheme);

        final Window window = activity.getWindow();
        // Method and constants not available on all SDKs but we want to be able to compile this code with any SDK
        window.clearFlags(0x04000000); // SDK 19: WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS);
        window.addFlags(0x80000000); // SDK 21: WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        try {
            // Using reflection makes sure any 5.0+ device will work without having to compile with SDK level 21

            window
                .getClass()
                .getMethod("setNavigationBarColor", int.class)
                .invoke(window, this.systemBarColor);

            window
                .getClass()
                .getMethod("setStatusBarColor", int.class)
                .invoke(window, this.systemBarColor);

            window.getDecorView().setBackgroundColor(this.systemBarColor);

            if (Build.VERSION.SDK_INT < 30) {
                setStatusBarStyle(window);
                setNavigationBarStyle(window);
            } else {
                String themeType = theme.getType();
                WindowInsetsController controller = window.getInsetsController();
                int appearance =
                    WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS |
                    WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;

                if (themeType.equals("light")) {
                    controller.setSystemBarsAppearance(appearance, appearance);
                } else {
                    controller.setSystemBarsAppearance(0, appearance);
                }
            }
            callback.success("OK");
        } catch (IllegalArgumentException error) {
            callback.error(error.toString());
        } catch (Exception error) {
            callback.error(error.toString());
        }
    }

    private void setStatusBarStyle(final Window window) {
        String themeType = theme.getType();
        View decorView = window.getDecorView();
        int uiOptions;
        int lightStatusBar;

        if (SDK_INT <= 30) {
            uiOptions = getDeprecatedSystemUiVisibility(decorView);
            lightStatusBar = deprecatedFlagUiLightStatusBar();

            if (themeType.equals("light")) {
                setDeprecatedSystemUiVisibility(decorView, uiOptions | lightStatusBar);
                return;
            }
            setDeprecatedSystemUiVisibility(decorView, uiOptions & ~lightStatusBar);
            return;
        }

        uiOptions = Objects.requireNonNull(decorView.getWindowInsetsController()).getSystemBarsAppearance();
        lightStatusBar = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS;

        if (themeType.equals("light")) {
            decorView.getWindowInsetsController().setSystemBarsAppearance(uiOptions | lightStatusBar, lightStatusBar);
            return;
        }

        decorView.getWindowInsetsController().setSystemBarsAppearance(uiOptions & ~lightStatusBar, lightStatusBar);
    }

    private void setNavigationBarStyle(final Window window) {
        String themeType = theme.getType();
        View decorView = window.getDecorView();
        int uiOptions;

        if (SDK_INT <= 30) {
            uiOptions = getDeprecatedSystemUiVisibility(decorView);
            // 0x80000000 FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS
            // 0x00000010 SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR

            if (themeType.equals("light")) {
                setDeprecatedSystemUiVisibility(decorView, uiOptions | 0x80000000 | 0x00000010);
                return;
            }
            setDeprecatedSystemUiVisibility(decorView, uiOptions | (0x80000000 & ~0x00000010));
            return;
        }

        uiOptions = Objects.requireNonNull(decorView.getWindowInsetsController()).getSystemBarsAppearance();
        int lightNavigationBar = WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;

        if (themeType.equals("light")) {
            decorView.getWindowInsetsController().setSystemBarsAppearance(uiOptions | lightNavigationBar, lightNavigationBar);
            return;
        }

        decorView.getWindowInsetsController().setSystemBarsAppearance(uiOptions & ~lightNavigationBar, lightNavigationBar);
    }

    private int deprecatedFlagUiLightStatusBar() {
        return View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
    }

    private int getDeprecatedSystemUiVisibility(View decorView) {
        return decorView.getSystemUiVisibility();
    }

    private void setDeprecatedSystemUiVisibility(View decorView, int visibility) {
        decorView.setSystemUiVisibility(visibility);
    }

    private void getCordovaIntent(CallbackContext callback) {
        Intent intent = activity.getIntent();
        callback.sendPluginResult(
            new PluginResult(PluginResult.Status.OK, getIntentJson(intent))
        );
    }

    private void setIntentHandler(CallbackContext callback) {
        intentHandler = callback;
        PluginResult result = new PluginResult(PluginResult.Status.NO_RESULT);
        result.setKeepCallback(true);
        callback.sendPluginResult(result);
    }

    @Override
    public void onNewIntent(Intent intent) {
        if (intentHandler != null) {
            PluginResult result = new PluginResult(
                PluginResult.Status.OK,
                getIntentJson(intent)
            );
            result.setKeepCallback(true);
            intentHandler.sendPluginResult(result);
        }
    }

    private JSONObject getIntentJson(Intent intent) {
        JSONObject json = new JSONObject();
        try {
            json.put("action", intent.getAction());
            json.put("data", intent.getDataString());
            json.put("type", intent.getType());
            json.put("package", intent.getPackage());
            json.put("extras", getExtrasJson(intent.getExtras()));
        } catch (JSONException e) {
            e.printStackTrace();
        }
        return json;
    }

    private JSONObject getExtrasJson(Bundle extras) {
        JSONObject json = new JSONObject();
        if (extras != null) {
            for (String key: extras.keySet()) {
                try {
                    Object value = extras.get(key);
                    if (value instanceof String) {
                        json.put(key, (String) value);
                    } else if (value instanceof Integer) {
                        json.put(key, (Integer) value);
                    } else if (value instanceof Long) {
                        json.put(key, (Long) value);
                    } else if (value instanceof Double) {
                        json.put(key, (Double) value);
                    } else if (value instanceof Float) {
                        json.put(key, (Float) value);
                    } else if (value instanceof Boolean) {
                        json.put(key, (Boolean) value);
                    } else if (value instanceof Bundle) {
                        json.put(key, getExtrasJson((Bundle) value));
                    } else {
                        json.put(key, value.toString());
                    }
                } catch (JSONException e) {
                    e.printStackTrace();
                }
            }
        }
        return json;
    }

    private Uri getContentProviderUri(String fileUri) {
        return this.getContentProviderUri(fileUri, "");
    }

    private Uri getContentProviderUri(String fileUri, String filename) {
        if (fileUri == null || fileUri.isEmpty()) {
            return null;
        }

        Uri uri = Uri.parse(fileUri);
        if (uri == null) {
            return null;
        }

        if ("file".equalsIgnoreCase(uri.getScheme())) {
            File originalFile = new File(uri.getPath());
            if (!originalFile.exists()) {
                Log.e("System", "File does not exist for URI: " + fileUri);
                return null;
            }

            String authority = getFileProviderAuthority();
            if (authority == null) {
                Log.e("System", "No FileProvider authority available.");
                return null;
            }

            try {
                return FileProvider.getUriForFile(context, authority, originalFile);
            } catch (IllegalArgumentException | SecurityException ex) {
                try {
                    File cacheCopy = ensureShareableCopy(originalFile, filename);
                    return FileProvider.getUriForFile(context, authority, cacheCopy);
                } catch (Exception copyError) {
                    Log.e("System", "Failed to expose file via FileProvider", copyError);
                    return null;
                }
            }
        }
        return uri;
    }

    private File ensureShareableCopy(File source, String displayName) throws IOException {
        File cacheRoot = new File(context.getCacheDir(), "shared");
        if (!cacheRoot.exists() && !cacheRoot.mkdirs()) {
            throw new IOException("Unable to create shared cache directory");
        }

        if (displayName != null && !displayName.isEmpty()) {
            displayName = new File(displayName).getName();
        }
        if (displayName == null || displayName.isEmpty()) {
            displayName = source.getName();
        }
        if (displayName == null || displayName.isEmpty()) {
            displayName = "shared-file";
        }

        File target = new File(cacheRoot, displayName);
        target = ensureUniqueFile(target);
        copyFile(source, target);
        return target;
    }

    private File ensureUniqueFile(File target) {
        if (!target.exists()) {
            return target;
        }

        String name = target.getName();
        String prefix = name;
        String suffix = "";
        int dotIndex = name.lastIndexOf('.');
        if (dotIndex > 0) {
            prefix = name.substring(0, dotIndex);
            suffix = name.substring(dotIndex);
        }

        int index = 1;
        File candidate = target;
        while (candidate.exists()) {
            candidate = new File(target.getParentFile(), prefix + "-" + index + suffix);
            index++;
        }
        return candidate;
    }

    private void copyFile(File source, File destination) throws IOException {
        try (
            InputStream in = new FileInputStream(source);
            OutputStream out = new FileOutputStream(destination)
        ) {
            byte[] buffer = new byte[8192];
            int length;
            while ((length = in.read(buffer)) != -1) {
                out.write(buffer, 0, length);
            }
            out.flush();
        }
    }

    private void grantUriPermissions(Intent intent, Uri uri, int flags) {
        if (uri == null) return;
        PackageManager pm = context.getPackageManager();
        List<ResolveInfo> resInfoList = pm.queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY);
        for (ResolveInfo resolveInfo: resInfoList) {
            String packageName = resolveInfo.activityInfo.packageName;
            context.grantUriPermission(packageName, uri, flags);
        }
    }

    private String resolveMimeType(String currentMime, Uri uri, String filename) {
        if (currentMime != null && !currentMime.isEmpty() && !currentMime.equals("*/*")) {
            return currentMime;
        }

        String mime = null;
        if (uri != null) {
            mime = context.getContentResolver().getType(uri);
        }

        if ((mime == null || mime.isEmpty()) && filename != null) {
            mime = getMimeTypeFromExtension(filename);
        }

        if ((mime == null || mime.isEmpty()) && uri != null) {
            String path = uri.getPath();
            if (path != null) {
                mime = getMimeTypeFromExtension(path);
            }
        }

        return (mime != null && !mime.isEmpty()) ? mime : "*/*";
    }

    private String getFileProviderAuthority() {
        if (fileProviderAuthority != null && !fileProviderAuthority.isEmpty()) {
            return fileProviderAuthority;
        }

        try {
            PackageManager pm = context.getPackageManager();
            PackageInfo packageInfo = pm.getPackageInfo(
                context.getPackageName(),
                PackageManager.GET_PROVIDERS
            );
            if (packageInfo.providers != null) {
                for (ProviderInfo providerInfo: packageInfo.providers) {
                    if (
                        providerInfo != null &&
                        providerInfo.name != null &&
                        providerInfo.name.equals(FileProvider.class.getName())
                    ) {
                        fileProviderAuthority = providerInfo.authority;
                        break;
                    }
                }
            }
        } catch (PackageManager.NameNotFoundException error) {
            Log.w(TAG, "Unable to inspect package providers for FileProvider authority.", error);
        }

        if (fileProviderAuthority == null || fileProviderAuthority.isEmpty()) {
            fileProviderAuthority = context.getPackageName() + ".provider";
        }

        return fileProviderAuthority;
    }

    private boolean isPackageInstalled(
        String packageName,
        PackageManager packageManager,
        CallbackContext callback
    ) {
        try {
            packageManager.getPackageInfo(packageName, 0);
            return true;
        } catch (PackageManager.NameNotFoundException e) {
            return false;
        }
    }

    private void getGlobalSetting(String setting, CallbackContext callback) {
        int value = (int) Global.getFloat(
            context.getContentResolver(),
            setting, -1
        );
        callback.success(value);
    }

    private void clearCache(CallbackContext callback) {
        webView.clearCache(true);
        callback.success("Cache cleared");
    }

    private void setInputType(String type) {
        int mode = -1;
        if (type.equals("NO_SUGGESTIONS")) {
            mode = 0;
        } else if (type.equals("NO_SUGGESTIONS_AGGRESSIVE")) {
            mode = 1;
        }
        webView.setInputType(mode);
    }

    private void setNativeContextMenuDisabled(boolean disabled) {
        View webViewView = webView == null ? null : webView.getView();
        if (webViewView == null) {
            return;
        }

        webViewView.setLongClickable(!disabled);
        webViewView.setHapticFeedbackEnabled(!disabled);
        if (disabled) {
            webViewView.setOnLongClickListener(v -> true);
        } else {
            webViewView.setOnLongClickListener(null);
        }

        try {
            Method method = webViewView
                .getClass()
                .getMethod("setNativeContextMenuDisabled", boolean.class);
            method.invoke(webViewView, disabled);
        } catch (NoSuchMethodException ignored) {
            // Fallback above keeps long-press context disabled even without CordovaLib patch.
        } catch (IllegalAccessException | InvocationTargetException e) {
            Log.w("System", "Failed to toggle native context menu state", e);
        }
    }
}

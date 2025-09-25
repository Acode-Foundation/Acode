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

import android.os.Build;
import android.os.Environment;
import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.provider.Settings;

import androidx.core.content.ContextCompat;



public class System extends CordovaPlugin {

    private CallbackContext requestPermissionCallback;
    private Activity activity;
    private Context context;
    private int REQ_PERMISSIONS = 1;
    private int REQ_PERMISSION = 2;
    private int systemBarColor = 0xFF000000;
    private Theme theme;
    private CallbackContext intentHandler;
    private CordovaWebView webView;

    public void initialize(CordovaInterface cordova, CordovaWebView webView) {
        super.initialize(cordova, webView);
        this.context = cordova.getContext();
        this.activity = cordova.getActivity();
        this.webView = webView;

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
                break;
            case "get-configuration":
                getConfiguration(callbackContext);
                return true;
            case "set-input-type":
                setInputType(arg1);
                callbackContext.success();
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
                File file = new File(args.getString(0));
                if (file.mkdirs()) {
                    callbackContext.success();
                } else {
                    callbackContext.error("mkdirs failed");
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
        Path p = new File(path).toPath();
        try {
            if (Boolean.parseBoolean(countSymlinks)) {
                // This will return true even for broken symlinks
                return Files.exists(p, LinkOption.NOFOLLOW_LINKS);
            } else {
                // Check target file, not symlink itself
                return Files.exists(p) && !Files.isSymbolicLink(p);
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
                if (permission != null || !permission.equals("")) {
                    throw new Exception("Permission cannot be null or empty");
                }
                if (!cordova.hasPermission(permission)) {
                    list.add(permission);
                }
            } catch (JSONException e) {}
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

    private void fileAction(
        String fileURI,
        String filename,
        String action,
        String mimeType,
        CallbackContext callback
    ) {
        Activity activity = this.activity;
        Context context = this.context;
        Uri uri = this.getContentProviderUri(fileURI);
        try {
            Intent intent = new Intent(action);

            if (mimeType.equals("")) {
                mimeType = "text/plain";
            }

            if (action.equals(Intent.ACTION_SEND)) {
                intent.putExtra(Intent.EXTRA_STREAM, uri);
                if (!filename.equals("")) {
                    intent.putExtra(Intent.EXTRA_TEXT, filename);
                }
                intent.setType(mimeType);
            } else {
                int flags =
                    Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION |
                    Intent.FLAG_GRANT_READ_URI_PERMISSION;

                if (action.equals(Intent.ACTION_EDIT)) {
                    flags |= Intent.FLAG_GRANT_WRITE_URI_PERMISSION;
                }

                intent.setFlags(flags);
                intent.setDataAndType(uri, mimeType);
            }

            activity.startActivity(intent);
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
        Uri uri = Uri.parse(fileUri);
        String Id = context.getPackageName();
        if (fileUri.matches("file:///(.*)")) {
            File file = new File(uri.getPath());
            if (filename.equals("")) {
                return FileProvider.getUriForFile(context, Id + ".provider", file);
            }

            return FileProvider.getUriForFile(
                context,
                Id + ".provider",
                file,
                filename
            );
        }
        return uri;
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
}
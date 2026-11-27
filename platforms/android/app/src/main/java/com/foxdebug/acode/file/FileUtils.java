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
package com.foxdebug.acode.file;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.util.Base64;
import android.util.Log;
import android.webkit.MimeTypeMap;
import android.webkit.WebResourceResponse;

import androidx.webkit.WebViewAssetLoader;

import com.foxdebug.acode.runtime.BridgeContext;
import com.foxdebug.acode.runtime.Callback;
import com.foxdebug.acode.runtime.Service;
import com.foxdebug.acode.runtime.ServicePathHandler;
import com.foxdebug.acode.runtime.ResourceApi;
import com.foxdebug.acode.runtime.Payload;

import org.jetbrains.annotations.NotNull;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.io.InputStream;
import java.net.MalformedURLException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;

/**
 * This class provides file and directory services to JavaScript.
 */
public class FileUtils extends Service {
    private static final String LOG_TAG = "FileUtils";

    public static int NOT_FOUND_ERR = 1;
    public static int SECURITY_ERR = 2;
    public static int ABORT_ERR = 3;

    public static int NOT_READABLE_ERR = 4;
    public static int ENCODING_ERR = 5;
    public static int NO_MODIFICATION_ALLOWED_ERR = 6;
    public static int INVALID_STATE_ERR = 7;
    public static int SYNTAX_ERR = 8;
    public static int INVALID_MODIFICATION_ERR = 9;
    public static int QUOTA_EXCEEDED_ERR = 10;
    public static int TYPE_MISMATCH_ERR = 11;
    public static int PATH_EXISTS_ERR = 12;

    /*
     * Permission callback codes
     */

    public static final int ACTION_GET_FILE = 0;
    public static final int ACTION_WRITE = 1;
    public static final int ACTION_GET_DIRECTORY = 2;
    public static final int ACTION_READ_ENTRIES = 3;

    public static final int WRITE = 3;
    public static final int READ = 4;

    public static int UNKNOWN_ERR = 1000;

    private boolean configured = false;

    private PendingRequests pendingRequests;

    // This field exists only to support getEntry, below, which has been deprecated
    private static FileUtils filePlugin;

    private interface FileOp {
        void run(JSONArray args) throws Exception;
    }

    private ArrayList<Filesystem> filesystems;

    public void registerFilesystem(Filesystem fs) {
        if (fs != null && filesystemForName(fs.name) == null) {
            this.filesystems.add(fs);
        }
    }

    private Filesystem filesystemForName(String name) {
        for (Filesystem fs : filesystems) {
            if (fs != null && fs.name != null && fs.name.equals(name)) {
                return fs;
            }
        }
        return null;
    }

    protected String[] getExtraFileSystemsPreference(Activity activity) {
        String fileSystemsStr = preferences.getString("androidextrafilesystems", "files,files-external,documents,sdcard,cache,cache-external,assets,root");
        return fileSystemsStr.split(",");
    }

    protected void registerExtraFileSystems(String[] filesystems, HashMap<String, String> availableFileSystems) {
        HashSet<String> installedFileSystems = new HashSet<String>();

        /* Register filesystems in order */
        for (String fsName : filesystems) {
            if (!installedFileSystems.contains(fsName)) {
                String fsRoot = availableFileSystems.get(fsName);
                if (fsRoot != null) {
                    File newRoot = new File(fsRoot);
                    if (newRoot.mkdirs() || newRoot.isDirectory()) {
                        registerFilesystem(new LocalFilesystem(fsName, webView.getContext(), webView.getResourceApi(), newRoot, preferences));
                        installedFileSystems.add(fsName);
                    } else {
                        Log.d(LOG_TAG, "Unable to create root dir for filesystem \"" + fsName + "\", skipping");
                    }
                } else {
                    Log.d(LOG_TAG, "Unrecognized extra filesystem identifier: " + fsName);
                }
            }
        }
    }

    protected HashMap<String, String> getAvailableFileSystems(Activity activity) {
        Context context = activity.getApplicationContext();
        HashMap<String, String> availableFileSystems = new HashMap<String, String>();

        availableFileSystems.put("files", context.getFilesDir().getAbsolutePath());
        availableFileSystems.put("documents", new File(context.getFilesDir(), "Documents").getAbsolutePath());
        availableFileSystems.put("cache", context.getCacheDir().getAbsolutePath());
        availableFileSystems.put("root", "/");
        if (Environment.getExternalStorageState().equals(Environment.MEDIA_MOUNTED)) {
            try {
                availableFileSystems.put("files-external", context.getExternalFilesDir(null).getAbsolutePath());
                availableFileSystems.put("sdcard", Environment.getExternalStorageDirectory().getAbsolutePath());
                availableFileSystems.put("cache-external", context.getExternalCacheDir().getAbsolutePath());
            } catch (NullPointerException e) {
                Log.d(LOG_TAG, "External storage unavailable, check to see if USB Mass Storage Mode is on");
            }
        }

        return availableFileSystems;
    }

    @Override
    public void initialize(BridgeContext bridgeContext) {
        super.initialize(bridgeContext);
        this.filesystems = new ArrayList<Filesystem>();
        this.pendingRequests = new PendingRequests();

        String tempRoot = null;
        String persistentRoot = null;

        Activity activity = host.getActivity();
        String packageName = activity.getPackageName();

        String location = preferences.getString("androidpersistentfilelocation", "internal");

        tempRoot = activity.getCacheDir().getAbsolutePath();
        if ("internal".equalsIgnoreCase(location)) {
            persistentRoot = activity.getFilesDir().getAbsolutePath() + "/files/";
            this.configured = true;
        } else if ("compatibility".equalsIgnoreCase(location)) {
            /*
             *  Fall-back to compatibility mode -- this is the logic implemented in
             *  earlier versions of this plugin, and should be maintained here so
             *  that apps which were originally deployed with older versions of the
             *  plugin can continue to provide access to files stored under those
             *  versions.
             */
            if (Environment.getExternalStorageState().equals(Environment.MEDIA_MOUNTED)) {
                persistentRoot = Environment.getExternalStorageDirectory().getAbsolutePath();
                tempRoot = Environment.getExternalStorageDirectory().getAbsolutePath() +
                        "/Android/data/" + packageName + "/cache/";
            } else {
                persistentRoot = "/data/data/" + packageName;
            }
            this.configured = true;
        }

        if (this.configured) {
            // Create the directories if they don't exist.
            File tmpRootFile = new File(tempRoot);
            File persistentRootFile = new File(persistentRoot);
            tmpRootFile.mkdirs();
            persistentRootFile.mkdirs();

            // Register initial filesystems
            // Note: The temporary and persistent filesystems need to be the first two
            // registered, so that they will match window.TEMPORARY and window.PERSISTENT,
            // per spec.
            this.registerFilesystem(new LocalFilesystem("temporary", webView.getContext(), webView.getResourceApi(), tmpRootFile, preferences));
            this.registerFilesystem(new LocalFilesystem("persistent", webView.getContext(), webView.getResourceApi(), persistentRootFile, preferences));
            this.registerFilesystem(new ContentFilesystem(webView.getContext(), webView.getResourceApi(), preferences));
            this.registerFilesystem(new AssetFilesystem(webView.getContext().getAssets(), webView.getResourceApi(), preferences));

            registerExtraFileSystems(getExtraFileSystemsPreference(activity), getAvailableFileSystems(activity));

            // Initialize static plugin reference for deprecated getEntry method
            if (filePlugin == null) {
                FileUtils.filePlugin = this;
            }
        } else {
            Log.e(LOG_TAG, "File plugin configuration error: Please set AndroidPersistentFileLocation in config.xml to one of \"internal\" (for new applications) or \"compatibility\" (for compatibility with previous versions)");
            activity.finish();
        }
    }

    public static FileUtils getFilePlugin() {
        return filePlugin;
    }

    private Filesystem filesystemForURL(LocalFilesystemURL localURL) {
        if (localURL == null) return null;
        return filesystemForName(localURL.fsName);
    }

    @Override
    public Uri remapUri(Uri uri) {
        // Remap only cdvfile: URLs (not content:).
        if (!LocalFilesystemURL.FILESYSTEM_PROTOCOL.equals(uri.getScheme())) {
            return null;
        }

        try {
            LocalFilesystemURL inputURL = LocalFilesystemURL.parse(uri);
            Filesystem fs = this.filesystemForURL(inputURL);
            if (fs == null) {
                return null;
            }
            String path = fs.filesystemPathForURL(inputURL);

            if (path != null) {
                return Uri.parse("file://" + fs.filesystemPathForURL(inputURL));
            }
            return null;
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    public boolean execute(String action, final String rawArgs, final Callback callbackContext) {
        if (!configured) {
            callbackContext.sendPayload(new Payload(Payload.Status.ERROR, "File plugin is not configured. Please see the README.md file for details on how to update config.xml"));
            return true;
        }

        if (action.equals("testSaveLocationExists")) {
            threadhelper(new FileOp() {
                public void run(JSONArray args) {

                    boolean b = DirectoryManager.testSaveLocationExists();
                    callbackContext.sendPayload(new Payload(Payload.Status.OK, b));
                }
            }, rawArgs, callbackContext);
        } else if (action.equals("getFreeDiskSpace")) {
            threadhelper(new FileOp() {
                public void run(JSONArray args) {
                    // The getFreeDiskSpace plugin API is not documented, but some apps call it anyway via exec().
                    // For compatibility it always returns free space in the primary external storage, and
                    // does NOT fallback to internal store if external storage is unavailable.
                    long l = DirectoryManager.getFreeExternalStorageSpace();
                    callbackContext.sendPayload(new Payload(Payload.Status.OK, l));
                }
            }, rawArgs, callbackContext);
        } else if (action.equals("testFileExists")) {
            threadhelper(new FileOp() {
                public void run(JSONArray args) throws JSONException {
                    String fname = args.getString(0);
                    boolean b = DirectoryManager.testFileExists(fname);
                    callbackContext.sendPayload(new Payload(Payload.Status.OK, b));
                }
            }, rawArgs, callbackContext);
        } else if (action.equals("testDirectoryExists")) {
            threadhelper(new FileOp() {
                public void run(JSONArray args) throws JSONException {
                    String fname = args.getString(0);
                    boolean b = DirectoryManager.testFileExists(fname);
                    callbackContext.sendPayload(new Payload(Payload.Status.OK, b));
                }
            }, rawArgs, callbackContext);
        } else if (action.equals("readAsText")) {
            threadhelper(new FileOp() {
                public void run(JSONArray args) throws JSONException, MalformedURLException {
                    String encoding = args.getString(1);
                    int start = args.getInt(2);
                    int end = args.getInt(3);
                    String fname = args.getString(0);
                    readFileAs(fname, start, end, callbackContext, encoding, Payload.MESSAGE_TYPE_STRING);
                }
            }, rawArgs, callbackContext);
        } else if (action.equals("readAsDataURL")) {
            threadhelper(new FileOp() {
                public void run(JSONArray args) throws JSONException, MalformedURLException {
                    int start = args.getInt(1);
                    int end = args.getInt(2);
                    String fname = args.getString(0);
                    readFileAs(fname, start, end, callbackContext, null, -1);
                }
            }, rawArgs, callbackContext);
        } else if (action.equals("readAsArrayBuffer")) {
            threadhelper(new FileOp() {
                public void run(JSONArray args) throws JSONException, MalformedURLException {
                    int start = args.getInt(1);
                    int end = args.getInt(2);
                    String fname = args.getString(0);
                    readFileAs(fname, start, end, callbackContext, null, Payload.MESSAGE_TYPE_ARRAYBUFFER);
                }
            }, rawArgs, callbackContext);
        } else if (action.equals("readAsBinaryString")) {
            threadhelper(new FileOp() {
                public void run(JSONArray args) throws JSONException, MalformedURLException {
                    int start = args.getInt(1);
                    int end = args.getInt(2);
                    String fname = args.getString(0);
                    readFileAs(fname, start, end, callbackContext, null, Payload.MESSAGE_TYPE_BINARYSTRING);
                }
            }, rawArgs, callbackContext);
        } else if (action.equals("write")) {
            threadhelper(new FileOp() {
                public void run(JSONArray args) throws JSONException, FileNotFoundException, IOException, NoModificationAllowedException {
                    String fname = args.getString(0);
                    String nativeURL = resolveLocalFileSystemURI(fname).getString("nativeURL");
                    String data = args.getString(1);
                    int offset = args.getInt(2);
                    Boolean isBinary = args.getBoolean(3);

                    if (needPermission(nativeURL, WRITE)) {
                        getWritePermission(rawArgs, ACTION_WRITE, callbackContext);
                    } else {
                        long fileSize = write(fname, data, offset, isBinary);
                        callbackContext.sendPayload(new Payload(Payload.Status.OK, fileSize));
                    }

                }
            }, rawArgs, callbackContext);
        } else if (action.equals("truncate")) {
            threadhelper(new FileOp() {
                public void run(JSONArray args) throws JSONException, FileNotFoundException, IOException, NoModificationAllowedException {
                    String fname = args.getString(0);
                    int offset = args.getInt(1);
                    long fileSize = truncateFile(fname, offset);
                    callbackContext.sendPayload(new Payload(Payload.Status.OK, fileSize));
                }
            }, rawArgs, callbackContext);
        } else if (action.equals("requestAllFileSystems")) {
            threadhelper(new FileOp() {
                public void run(JSONArray args) throws IOException, JSONException {
                    callbackContext.success(requestAllFileSystems());
                }
            }, rawArgs, callbackContext);
        } else if (action.equals("requestAllPaths")) {
            host.getThreadPool().execute(
                    new Runnable() {
                        public void run() {
                            try {
                                callbackContext.success(requestAllPaths());
                            } catch (JSONException e) {
                                // TODO Auto-generated catch block
                                e.printStackTrace();
                            }
                        }
                    }
            );
        } else if (action.equals("requestFileSystem")) {
            threadhelper(new FileOp() {
                public void run(JSONArray args) throws JSONException {
                    int fstype = args.getInt(0);
                    long requiredSize = args.optLong(1);
                    requestFileSystem(fstype, requiredSize, callbackContext);
                }
            }, rawArgs, callbackContext);
        } else if (action.equals("resolveLocalFileSystemURI")) {
            threadhelper(new FileOp() {
                public void run(JSONArray args) throws IOException, JSONException {
                    String fname = args.getString(0);
                    JSONObject obj = resolveLocalFileSystemURI(fname);
                    callbackContext.success(obj);
                }
            }, rawArgs, callbackContext);
        } else if (action.equals("getFileMetadata")) {
            threadhelper(new FileOp() {
                public void run(JSONArray args) throws FileNotFoundException, JSONException, MalformedURLException {
                    String fname = args.getString(0);
                    JSONObject obj = getFileMetadata(fname);
                    callbackContext.success(obj);
                }
            }, rawArgs, callbackContext);
        } else if (action.equals("getParent")) {
            threadhelper(new FileOp() {
                public void run(JSONArray args) throws JSONException, IOException {
                    String fname = args.getString(0);
                    JSONObject obj = getParent(fname);
                    callbackContext.success(obj);
                }
            }, rawArgs, callbackContext);
        } else if (action.equals("getDirectory")) {
            threadhelper(new FileOp() {
                public void run(JSONArray args) throws FileExistsException, IOException, TypeMismatchException, EncodingException, JSONException {
                    String dirname = args.getString(0);
                    String path = args.getString(1);
                    String nativeURL = resolveLocalFileSystemURI(dirname).getString("nativeURL");
                    boolean containsCreate = (args.isNull(2)) ? false : args.getJSONObject(2).optBoolean("create", false);

                    if (containsCreate && needPermission(nativeURL, WRITE)) {
                        getWritePermission(rawArgs, ACTION_GET_DIRECTORY, callbackContext);
                    } else if (!containsCreate && needPermission(nativeURL, READ)) {
                        getReadPermission(rawArgs, ACTION_GET_DIRECTORY, callbackContext);
                    } else {
                        JSONObject obj = getFile(dirname, path, args.optJSONObject(2), true);
                        callbackContext.success(obj);
                    }
                }
            }, rawArgs, callbackContext);
        } else if (action.equals("getFile")) {
            threadhelper(new FileOp() {
                public void run(JSONArray args) throws FileExistsException, IOException, TypeMismatchException, EncodingException, JSONException {
                    String dirname = args.getString(0);
                    String path = args.getString(1);

                    if (dirname.contains(LocalFilesystemURL.CDVFILE_KEYWORD) == true) {
                        JSONObject obj = getFile(dirname, path, args.optJSONObject(2), false);
                        callbackContext.success(obj);
                    } else {
                        String nativeURL = resolveLocalFileSystemURI(dirname).getString("nativeURL");
                        boolean containsCreate = (args.isNull(2)) ? false : args.getJSONObject(2).optBoolean("create", false);

                        if (containsCreate && needPermission(nativeURL, WRITE)) {
                            getWritePermission(rawArgs, ACTION_GET_FILE, callbackContext);
                        } else if (!containsCreate && needPermission(nativeURL, READ)) {
                            getReadPermission(rawArgs, ACTION_GET_FILE, callbackContext);
                        } else {
                            JSONObject obj = getFile(dirname, path, args.optJSONObject(2), false);
                            callbackContext.success(obj);
                        }
                    }
                }
            }, rawArgs, callbackContext);
        } else if (action.equals("remove")) {
            threadhelper(new FileOp() {
                public void run(JSONArray args) throws JSONException, NoModificationAllowedException, InvalidModificationException, MalformedURLException {
                    String fname = args.getString(0);
                    boolean success = remove(fname);
                    if (success) {
                        callbackContext.success();
                    } else {
                        callbackContext.error(FileUtils.NO_MODIFICATION_ALLOWED_ERR);
                    }
                }
            }, rawArgs, callbackContext);
        } else if (action.equals("removeRecursively")) {
            threadhelper(new FileOp() {
                public void run(JSONArray args) throws JSONException, FileExistsException, MalformedURLException, NoModificationAllowedException {
                    String fname = args.getString(0);
                    boolean success = removeRecursively(fname);
                    if (success) {
                        callbackContext.success();
                    } else {
                        callbackContext.error(FileUtils.NO_MODIFICATION_ALLOWED_ERR);
                    }
                }
            }, rawArgs, callbackContext);
        } else if (action.equals("moveTo")) {
            threadhelper(new FileOp() {
                public void run(JSONArray args) throws JSONException, NoModificationAllowedException, IOException, InvalidModificationException, EncodingException, FileExistsException {
                    String fname = args.getString(0);
                    String newParent = args.getString(1);
                    String newName = args.getString(2);
                    JSONObject entry = transferTo(fname, newParent, newName, true);
                    callbackContext.success(entry);
                }
            }, rawArgs, callbackContext);
        } else if (action.equals("copyTo")) {
            threadhelper(new FileOp() {
                public void run(JSONArray args) throws JSONException, NoModificationAllowedException, IOException, InvalidModificationException, EncodingException, FileExistsException {
                    String fname = args.getString(0);
                    String newParent = args.getString(1);
                    String newName = args.getString(2);
                    JSONObject entry = transferTo(fname, newParent, newName, false);
                    callbackContext.success(entry);
                }
            }, rawArgs, callbackContext);
        } else if (action.equals("readEntries")) {
            threadhelper(new FileOp() {
                public void run(JSONArray args) throws FileNotFoundException, JSONException, MalformedURLException, IOException {
                    String directory = args.getString(0);
                    String nativeURL = resolveLocalFileSystemURI(directory).getString("nativeURL");
                    if (needPermission(nativeURL, READ)) {
                        getReadPermission(rawArgs, ACTION_READ_ENTRIES, callbackContext);
                    } else {
                        JSONArray entries = readEntries(directory);
                        callbackContext.success(entries);
                    }
                }
            }, rawArgs, callbackContext);
        } else if (action.equals("_getLocalFilesystemPath")) {
            // Internal method for testing: Get the on-disk location of a local filesystem url.
            // [Currently used for testing file-transfer]
            threadhelper(new FileOp() {
                public void run(JSONArray args) throws FileNotFoundException, JSONException, MalformedURLException {
                    String localURLstr = args.getString(0);
                    String fname = filesystemPathForURL(localURLstr);
                    callbackContext.success(fname);
                }
            }, rawArgs, callbackContext);
        } else {
            return false;
        }
        return true;
    }

    private void getReadPermission(String rawArgs, int action, Callback callbackContext) {
        int requestCode = pendingRequests.createRequest(rawArgs, action, callbackContext);
        if (android.os.Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            host.requestPermissions(this, requestCode,
                    new String[]{Manifest.permission.READ_MEDIA_IMAGES, Manifest.permission.READ_MEDIA_VIDEO, Manifest.permission.READ_MEDIA_AUDIO});
        } else {
            host.requestPermission(this, requestCode, Manifest.permission.READ_EXTERNAL_STORAGE);
        }
    }

    private void getWritePermission(String rawArgs, int action, Callback callbackContext) {
        if (android.os.Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            int requestCode = pendingRequests.createRequest(rawArgs, action, callbackContext);
            host.requestPermission(this, requestCode, Manifest.permission.WRITE_EXTERNAL_STORAGE);
        }
    }

    /**
     * If your app targets Android 13 (SDK 33) or higher and needs to access media files that other apps have created,
     * you must request one or more of the following granular media permissions READ_MEDIA_*
     * instead of the READ_EXTERNAL_STORAGE permission:
     *
     * Refer to: https://developer.android.com/about/versions/13/behavior-changes-13
     *
     * @return
     */
    private boolean hasReadPermission() {
        if (android.os.Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return host.hasPermission(Manifest.permission.READ_MEDIA_IMAGES)
                    && host.hasPermission(Manifest.permission.READ_MEDIA_VIDEO)
                    && host.hasPermission(Manifest.permission.READ_MEDIA_AUDIO);
        } else {
            return host.hasPermission(Manifest.permission.READ_EXTERNAL_STORAGE);
        }
    }

    private boolean hasWritePermission() {
        // Starting with API 33, requesting WRITE_EXTERNAL_STORAGE is an auto permission rejection
        return android.os.Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                ? true
                : host.hasPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE);
    }

    private boolean needPermission(String nativeURL, int permissionType) throws JSONException {
        JSONObject j = requestAllPaths();
        ArrayList<String> allowedStorageDirectories = new ArrayList<String>();
        allowedStorageDirectories.add(j.getString("applicationDirectory"));
        allowedStorageDirectories.add(j.getString("applicationStorageDirectory"));
        if (j.has("externalApplicationStorageDirectory")) {
            allowedStorageDirectories.add(j.getString("externalApplicationStorageDirectory"));
        }

        if (permissionType == READ && hasReadPermission()) {
            return false;
        } else if (permissionType == WRITE && hasWritePermission()) {
            return false;
        }

        // Permission required if the native url lies outside the allowed storage directories
        for (String directory : allowedStorageDirectories) {
            if (nativeURL.startsWith(directory)) {
                return false;
            }
        }
        return true;
    }


    public LocalFilesystemURL resolveNativeUri(Uri nativeUri) {
        LocalFilesystemURL localURL = null;

        // Try all installed filesystems. Return the best matching URL
        // (determined by the shortest resulting URL)
        for (Filesystem fs : filesystems) {
            LocalFilesystemURL url = fs.toLocalUri(nativeUri);
            if (url != null) {
                // A shorter fullPath implies that the filesystem is a better
                // match for the local path than the previous best.
                if (localURL == null || (url.uri.toString().length() < localURL.toString().length())) {
                    localURL = url;
                }
            }
        }
        return localURL;
    }

    /*
     * These two native-only methods can be used by other plugins to translate between
     * device file system paths and URLs. By design, there is no direct JavaScript
     * interface to these methods.
     */

    public String filesystemPathForURL(String localURLstr) throws MalformedURLException {
        try {
            LocalFilesystemURL inputURL = LocalFilesystemURL.parse(localURLstr);
            Filesystem fs = this.filesystemForURL(inputURL);
            if (fs == null) {
                throw new MalformedURLException("No installed handlers for this URL");
            }
            return fs.filesystemPathForURL(inputURL);
        } catch (IllegalArgumentException e) {
            MalformedURLException mue = new MalformedURLException("Unrecognized filesystem URL");
            mue.initCause(e);
            throw mue;
        }
    }

    public LocalFilesystemURL filesystemURLforLocalPath(String localPath) {
        LocalFilesystemURL localURL = null;
        int shortestFullPath = 0;

        // Try all installed filesystems. Return the best matching URL
        // (determined by the shortest resulting URL)
        for (Filesystem fs : filesystems) {
            LocalFilesystemURL url = fs.URLforFilesystemPath(localPath);
            if (url != null) {
                // A shorter fullPath implies that the filesystem is a better
                // match for the local path than the previous best.
                if (localURL == null || (url.path.length() < shortestFullPath)) {
                    localURL = url;
                    shortestFullPath = url.path.length();
                }
            }
        }
        return localURL;
    }


    /* helper to execute functions async and handle the result codes
     *
     */
    private void threadhelper(final FileOp f, final String rawArgs, final Callback callbackContext) {
        host.getThreadPool().execute(new Runnable() {
            public void run() {
                try {
                    JSONArray args = new JSONArray(rawArgs);
                    f.run(args);
                } catch (Exception e) {
                    if (e instanceof EncodingException) {
                        callbackContext.error(FileUtils.ENCODING_ERR);
                    } else if (e instanceof FileNotFoundException) {
                        callbackContext.error(FileUtils.NOT_FOUND_ERR);
                    } else if (e instanceof FileExistsException) {
                        callbackContext.error(FileUtils.PATH_EXISTS_ERR);
                    } else if (e instanceof NoModificationAllowedException) {
                        callbackContext.error(FileUtils.NO_MODIFICATION_ALLOWED_ERR);
                    } else if (e instanceof InvalidModificationException) {
                        callbackContext.error(FileUtils.INVALID_MODIFICATION_ERR);
                    } else if (e instanceof MalformedURLException) {
                        callbackContext.error(FileUtils.ENCODING_ERR);
                    } else if (e instanceof IOException) {
                        callbackContext.error(FileUtils.INVALID_MODIFICATION_ERR);
                    } else if (e instanceof TypeMismatchException) {
                        callbackContext.error(FileUtils.TYPE_MISMATCH_ERR);
                    } else if (e instanceof JSONException) {
                        callbackContext.sendPayload(new Payload(Payload.Status.JSON_EXCEPTION));
                    } else if (e instanceof SecurityException) {
                        callbackContext.error(FileUtils.SECURITY_ERR);
                    } else {
                        e.printStackTrace();
                        callbackContext.error(FileUtils.UNKNOWN_ERR);
                    }
                }
            }
        });
    }

    /**
     * Allows the user to look up the Entry for a file or directory referred to by a local URI.
     *
     * @param uriString of the file/directory to look up
     * @return a JSONObject representing a Entry from the filesystem
     * @throws MalformedURLException if the url is not valid
     * @throws FileNotFoundException if the file does not exist
     * @throws IOException           if the user can't read the file
     * @throws JSONException
     */
    private JSONObject resolveLocalFileSystemURI(String uriString) throws IOException, JSONException {
        if (uriString == null) {
            throw new MalformedURLException("Unrecognized filesystem URL");
        }
        Uri uri = Uri.parse(uriString);
        boolean isNativeUri = false;

        LocalFilesystemURL inputURL = LocalFilesystemURL.parse(uri);
        if (inputURL == null) {
            /* Check for file://, content:// urls */
            inputURL = resolveNativeUri(uri);
            isNativeUri = true;
        }

        try {
            Filesystem fs = this.filesystemForURL(inputURL);
            if (fs == null) {
                throw new MalformedURLException("No installed handlers for this URL");
            }
            if (fs.exists(inputURL)) {
                if (!isNativeUri) {
                    // If not already resolved as native URI, resolve to a native URI and back to
                    // fix the terminating slash based on whether the entry is a directory or file.
                    inputURL = fs.toLocalUri(fs.toNativeUri(inputURL));
                }

                return fs.getEntryForLocalURL(inputURL);
            }
        } catch (IllegalArgumentException e) {
            MalformedURLException mue = new MalformedURLException("Unrecognized filesystem URL");
            mue.initCause(e);
            throw mue;
        }
        throw new FileNotFoundException();
    }

    /**
     * Read the list of files from this directory.
     *
     * @return a JSONArray containing JSONObjects that represent Entry objects.
     * @throws FileNotFoundException if the directory is not found.
     * @throws JSONException
     * @throws MalformedURLException
     */
    private JSONArray readEntries(String baseURLstr) throws FileNotFoundException, JSONException, MalformedURLException {
        try {
            LocalFilesystemURL inputURL = LocalFilesystemURL.parse(baseURLstr);
            Filesystem fs = this.filesystemForURL(inputURL);
            if (fs == null) {
                throw new MalformedURLException("No installed handlers for this URL");
            }
            return fs.readEntriesAtLocalURL(inputURL);

        } catch (IllegalArgumentException e) {
            MalformedURLException mue = new MalformedURLException("Unrecognized filesystem URL");
            mue.initCause(e);
            throw mue;
        }
    }

    /**
     * A setup method that handles the move/copy of files/directories
     *
     * @param newName for the file directory to be called, if null use existing file name
     * @param move    if false do a copy, if true do a move
     * @return a Entry object
     * @throws NoModificationAllowedException
     * @throws IOException
     * @throws InvalidModificationException
     * @throws EncodingException
     * @throws JSONException
     * @throws FileExistsException
     */
    private JSONObject transferTo(String srcURLstr, String destURLstr, String newName, boolean move) throws JSONException, NoModificationAllowedException, IOException, InvalidModificationException, EncodingException, FileExistsException {
        if (srcURLstr == null || destURLstr == null) {
            // either no source or no destination provided
            throw new FileNotFoundException();
        }

        LocalFilesystemURL srcURL = LocalFilesystemURL.parse(srcURLstr);
        LocalFilesystemURL destURL = LocalFilesystemURL.parse(destURLstr);

        Filesystem srcFs = this.filesystemForURL(srcURL);
        Filesystem destFs = this.filesystemForURL(destURL);

        // Check for invalid file name
        if (newName != null && newName.contains(":")) {
            throw new EncodingException("Bad file name");
        }

        return destFs.copyFileToURL(destURL, newName, srcFs, srcURL, move);
    }

    /**
     * Deletes a directory and all of its contents, if any. In the event of an error
     * [e.g. trying to delete a directory that contains a file that cannot be removed],
     * some of the contents of the directory may be deleted.
     * It is an error to attempt to delete the root directory of a filesystem.
     *
     * @return a boolean representing success of failure
     * @throws FileExistsException
     * @throws NoModificationAllowedException
     * @throws MalformedURLException
     */
    private boolean removeRecursively(String baseURLstr) throws FileExistsException, NoModificationAllowedException, MalformedURLException {
        try {
            LocalFilesystemURL inputURL = LocalFilesystemURL.parse(baseURLstr);
            // You can't delete the root directory.
            if ("".equals(inputURL.path) || "/".equals(inputURL.path)) {
                throw new NoModificationAllowedException("You can't delete the root directory");
            }

            Filesystem fs = this.filesystemForURL(inputURL);
            if (fs == null) {
                throw new MalformedURLException("No installed handlers for this URL");
            }
            return fs.recursiveRemoveFileAtLocalURL(inputURL);

        } catch (IllegalArgumentException e) {
            MalformedURLException mue = new MalformedURLException("Unrecognized filesystem URL");
            mue.initCause(e);
            throw mue;
        }
    }


    /**
     * Deletes a file or directory. It is an error to attempt to delete a directory that is not empty.
     * It is an error to attempt to delete the root directory of a filesystem.
     *
     * @return a boolean representing success of failure
     * @throws NoModificationAllowedException
     * @throws InvalidModificationException
     * @throws MalformedURLException
     */
    private boolean remove(String baseURLstr) throws NoModificationAllowedException, InvalidModificationException, MalformedURLException {
        try {
            LocalFilesystemURL inputURL = LocalFilesystemURL.parse(baseURLstr);
            // You can't delete the root directory.
            if ("".equals(inputURL.path) || "/".equals(inputURL.path)) {

                throw new NoModificationAllowedException("You can't delete the root directory");
            }

            Filesystem fs = this.filesystemForURL(inputURL);
            if (fs == null) {
                throw new MalformedURLException("No installed handlers for this URL");
            }
            return fs.removeFileAtLocalURL(inputURL);

        } catch (IllegalArgumentException e) {
            MalformedURLException mue = new MalformedURLException("Unrecognized filesystem URL");
            mue.initCause(e);
            throw mue;
        }
    }

    /**
     * Creates or looks up a file.
     *
     * @param baseURLstr base directory
     * @param path       file/directory to lookup or create
     * @param options    specify whether to create or not
     * @param directory  if true look up directory, if false look up file
     * @return a Entry object
     * @throws FileExistsException
     * @throws IOException
     * @throws TypeMismatchException
     * @throws EncodingException
     * @throws JSONException
     */
    private JSONObject getFile(String baseURLstr, String path, JSONObject options, boolean directory) throws FileExistsException, IOException, TypeMismatchException, EncodingException, JSONException {
        try {
            LocalFilesystemURL inputURL = LocalFilesystemURL.parse(baseURLstr);

            Filesystem fs = this.filesystemForURL(inputURL);
            if (fs == null) {
                throw new MalformedURLException("No installed handlers for this URL");
            }
            return fs.getFileForLocalURL(inputURL, path, options, directory);

        } catch (IllegalArgumentException e) {
            MalformedURLException mue = new MalformedURLException("Unrecognized filesystem URL");
            mue.initCause(e);
            throw mue;
        }

    }

    /**
     * Look up the parent DirectoryEntry containing this Entry.
     * If this Entry is the root of its filesystem, its parent is itself.
     */
    private JSONObject getParent(String baseURLstr) throws JSONException, IOException {
        try {
            LocalFilesystemURL inputURL = LocalFilesystemURL.parse(baseURLstr);
            Filesystem fs = this.filesystemForURL(inputURL);
            if (fs == null) {
                throw new MalformedURLException("No installed handlers for this URL");
            }
            return fs.getParentForLocalURL(inputURL);

        } catch (IllegalArgumentException e) {
            MalformedURLException mue = new MalformedURLException("Unrecognized filesystem URL");
            mue.initCause(e);
            throw mue;
        }
    }

    /**
     * Returns a File that represents the current state of the file that this FileEntry represents.
     *
     * @return returns a JSONObject represent a W3C File object
     */
    private JSONObject getFileMetadata(String baseURLstr) throws FileNotFoundException, JSONException, MalformedURLException {
        try {
            LocalFilesystemURL inputURL = LocalFilesystemURL.parse(baseURLstr);
            Filesystem fs = this.filesystemForURL(inputURL);
            if (fs == null) {
                throw new MalformedURLException("No installed handlers for this URL");
            }
            return fs.getFileMetadataForLocalURL(inputURL);

        } catch (IllegalArgumentException e) {
            MalformedURLException mue = new MalformedURLException("Unrecognized filesystem URL");
            mue.initCause(e);
            throw mue;
        }
    }

    /**
     * Requests a filesystem in which to store application data.
     *
     * @param type            of file system requested
     * @param requiredSize    required free space in the file system in bytes
     * @param callbackContext context for returning the result or error
     * @throws JSONException
     */
    private void requestFileSystem(int type, long requiredSize, final Callback callbackContext) throws JSONException {
        Filesystem rootFs = null;
        try {
            rootFs = this.filesystems.get(type);
        } catch (ArrayIndexOutOfBoundsException e) {
            // Pass null through
        }
        if (rootFs == null) {
            callbackContext.sendPayload(new Payload(Payload.Status.ERROR, FileUtils.NOT_FOUND_ERR));
        } else {
            // If a nonzero required size was specified, check that the retrieved filesystem has enough free space.
            long availableSize = 0;
            if (requiredSize > 0) {
                availableSize = rootFs.getFreeSpaceInBytes();
            }

            if (availableSize < requiredSize) {
                callbackContext.sendPayload(new Payload(Payload.Status.ERROR, FileUtils.QUOTA_EXCEEDED_ERR));
            } else {
                JSONObject fs = new JSONObject();
                fs.put("name", rootFs.name);
                fs.put("root", rootFs.getRootEntry());
                callbackContext.success(fs);
            }
        }
    }

    /**
     * Requests a filesystem in which to store application data.
     *
     * @return a JSONObject representing the file system
     */
    private JSONArray requestAllFileSystems() throws IOException, JSONException {
        JSONArray ret = new JSONArray();
        for (Filesystem fs : filesystems) {
            ret.put(fs.getRootEntry());
        }
        return ret;
    }

    private static String toDirUrl(File f) {
        return Uri.fromFile(f).toString() + '/';
    }

    private JSONObject requestAllPaths() throws JSONException {
        Context context = host.getActivity();
        JSONObject ret = new JSONObject();
        ret.put("applicationDirectory", "file:///android_asset/");
        ret.put("applicationStorageDirectory", toDirUrl(context.getFilesDir().getParentFile()));
        ret.put("dataDirectory", toDirUrl(context.getFilesDir()));
        ret.put("cacheDirectory", toDirUrl(context.getCacheDir()));
        if (Environment.getExternalStorageState().equals(Environment.MEDIA_MOUNTED)) {
            try {
                ret.put("externalApplicationStorageDirectory", toDirUrl(context.getExternalFilesDir(null).getParentFile()));
                ret.put("externalDataDirectory", toDirUrl(context.getExternalFilesDir(null)));
                ret.put("externalCacheDirectory", toDirUrl(context.getExternalCacheDir()));
                ret.put("externalRootDirectory", toDirUrl(Environment.getExternalStorageDirectory()));
            } catch (NullPointerException e) {
                /* If external storage is unavailable, context.getExternal* returns null */
                Log.d(LOG_TAG, "Unable to access these paths, most liklely due to USB storage");
            }
        }
        return ret;
    }

    /**
     * Returns a JSON object representing the given File. Internal APIs should be modified
     * to use URLs instead of raw FS paths wherever possible, when interfacing with this plugin.
     *
     * @param file the File to convert
     * @return a JSON representation of the given File
     * @throws JSONException
     */
    public JSONObject getEntryForFile(File file) throws JSONException {
        JSONObject entry;

        for (Filesystem fs : filesystems) {
            entry = fs.makeEntryForFile(file);
            if (entry != null) {
                return entry;
            }
        }
        return null;
    }

    /**
     * Returns a JSON object representing the given File. Deprecated, as this is only used by
     * FileTransfer, and because it is a static method that should really be an instance method,
     * since it depends on the actual filesystem roots in use. Internal APIs should be modified
     * to use URLs instead of raw FS paths wherever possible, when interfacing with this plugin.
     *
     * @param file the File to convert
     * @return a JSON representation of the given File
     * @throws JSONException
     */
    @Deprecated
    public static JSONObject getEntry(File file) throws JSONException {
        if (getFilePlugin() != null) {
            return getFilePlugin().getEntryForFile(file);
        }
        return null;
    }

    /**
     * Read the contents of a file.
     * This is done in a background thread; the result is sent to the callback.
     *
     * @param start           Start position in the file.
     * @param end             End position to stop at (exclusive).
     * @param callbackContext The context through which to send the result.
     * @param encoding        The encoding to return contents as.  Typical value is UTF-8. (see http://www.iana.org/assignments/character-sets)
     * @param resultType      The desired type of data to send to the callback.
     * @return Contents of file.
     */
    public void readFileAs(final String srcURLstr, final int start, final int end, final Callback callbackContext, final String encoding, final int resultType) throws MalformedURLException {
        try {
            LocalFilesystemURL inputURL = LocalFilesystemURL.parse(srcURLstr);
            Filesystem fs = this.filesystemForURL(inputURL);
            if (fs == null) {
                throw new MalformedURLException("No installed handlers for this URL");
            }

            fs.readFileAtURL(inputURL, start, end, new Filesystem.ReadFileCallback() {
                public void handleData(InputStream inputStream, String contentType) {
                    try {
                        ByteArrayOutputStream os = new ByteArrayOutputStream();
                        final int BUFFER_SIZE = 8192;
                        byte[] buffer = new byte[BUFFER_SIZE];

                        for (; ; ) {
                            int bytesRead = inputStream.read(buffer, 0, BUFFER_SIZE);

                            if (bytesRead <= 0) {
                                break;
                            }
                            os.write(buffer, 0, bytesRead);
                        }

                        Payload result;
                        switch (resultType) {
                            case Payload.MESSAGE_TYPE_STRING:
                                result = new Payload(Payload.Status.OK, os.toString(encoding));
                                break;
                            case Payload.MESSAGE_TYPE_ARRAYBUFFER:
                                result = new Payload(Payload.Status.OK, os.toByteArray());
                                break;
                            case Payload.MESSAGE_TYPE_BINARYSTRING:
                                result = new Payload(Payload.Status.OK, os.toByteArray(), true);
                                break;
                            default: // Base64.
                                byte[] base64 = Base64.encode(os.toByteArray(), Base64.NO_WRAP);
                                String s = "data:" + contentType + ";base64," + new String(base64, "US-ASCII");
                                result = new Payload(Payload.Status.OK, s);
                        }

                        callbackContext.sendPayload(result);
                    } catch (IOException e) {
                        Log.d(LOG_TAG, e.getLocalizedMessage());
                        callbackContext.sendPayload(new Payload(Payload.Status.IO_EXCEPTION, NOT_READABLE_ERR));
                    }
                }
            });


        } catch (IllegalArgumentException e) {
            MalformedURLException mue = new MalformedURLException("Unrecognized filesystem URL");
            mue.initCause(e);
            throw mue;
        } catch (FileNotFoundException e) {
            callbackContext.sendPayload(new Payload(Payload.Status.IO_EXCEPTION, NOT_FOUND_ERR));
        } catch (IOException e) {
            Log.d(LOG_TAG, e.getLocalizedMessage());
            callbackContext.sendPayload(new Payload(Payload.Status.IO_EXCEPTION, NOT_READABLE_ERR));
        }
    }


    /**
     * Write contents of file.
     *
     * @param data     The contents of the file.
     * @param offset   The position to begin writing the file.
     * @param isBinary True if the file contents are base64-encoded binary data
     */
    /**/
    public long write(String srcURLstr, String data, int offset, boolean isBinary) throws FileNotFoundException, IOException, NoModificationAllowedException {
        try {
            LocalFilesystemURL inputURL = LocalFilesystemURL.parse(srcURLstr);
            Filesystem fs = this.filesystemForURL(inputURL);
            if (fs == null) {
                throw new MalformedURLException("No installed handlers for this URL");
            }

            return fs.writeToFileAtURL(inputURL, data, offset, isBinary);
        } catch (IllegalArgumentException e) {
            MalformedURLException mue = new MalformedURLException("Unrecognized filesystem URL");
            mue.initCause(e);
            throw mue;
        }

    }

    /**
     * Truncate the file to size
     */
    private long truncateFile(String srcURLstr, long size) throws FileNotFoundException, IOException, NoModificationAllowedException {
        try {
            LocalFilesystemURL inputURL = LocalFilesystemURL.parse(srcURLstr);
            Filesystem fs = this.filesystemForURL(inputURL);
            if (fs == null) {
                throw new MalformedURLException("No installed handlers for this URL");
            }

            return fs.truncateFileAtURL(inputURL, size);
        } catch (IllegalArgumentException e) {
            MalformedURLException mue = new MalformedURLException("Unrecognized filesystem URL");
            mue.initCause(e);
            throw mue;
        }
    }


    /*
     * Handle the response
     */

    public void onRequestPermissionResult(int requestCode, String[] permissions,
                                          int[] grantResults) throws JSONException {

        final PendingRequests.Request req = pendingRequests.getAndRemove(requestCode);
        if (req != null) {
            for (int r : grantResults) {
                if (r == PackageManager.PERMISSION_DENIED) {
                    req.getCallbackContext().sendPayload(new Payload(Payload.Status.ERROR, SECURITY_ERR));
                    return;
                }
            }
            switch (req.getAction()) {
                case ACTION_GET_FILE:
                    threadhelper(new FileOp() {
                        public void run(JSONArray args) throws FileExistsException, IOException, TypeMismatchException, EncodingException, JSONException {
                            String dirname = args.getString(0);

                            String path = args.getString(1);
                            JSONObject obj = getFile(dirname, path, args.optJSONObject(2), false);
                            req.getCallbackContext().success(obj);
                        }
                    }, req.getRawArgs(), req.getCallbackContext());
                    break;
                case ACTION_GET_DIRECTORY:
                    threadhelper(new FileOp() {
                        public void run(JSONArray args) throws FileExistsException, IOException, TypeMismatchException, EncodingException, JSONException {
                            String dirname = args.getString(0);

                            String path = args.getString(1);
                            JSONObject obj = getFile(dirname, path, args.optJSONObject(2), true);
                            req.getCallbackContext().success(obj);
                        }
                    }, req.getRawArgs(), req.getCallbackContext());
                    break;
                case ACTION_WRITE:
                    threadhelper(new FileOp() {
                        public void run(JSONArray args) throws JSONException, FileNotFoundException, IOException, NoModificationAllowedException {
                            String fname = args.getString(0);
                            String data = args.getString(1);
                            int offset = args.getInt(2);
                            Boolean isBinary = args.getBoolean(3);
                            long fileSize = write(fname, data, offset, isBinary);
                            req.getCallbackContext().sendPayload(new Payload(Payload.Status.OK, fileSize));
                        }
                    }, req.getRawArgs(), req.getCallbackContext());
                    break;
                case ACTION_READ_ENTRIES:
                    threadhelper(new FileOp() {
                        public void run(JSONArray args) throws FileNotFoundException, JSONException, MalformedURLException {
                            String fname = args.getString(0);
                            JSONArray entries = readEntries(fname);
                            req.getCallbackContext().success(entries);
                        }
                    }, req.getRawArgs(), req.getCallbackContext());
                    break;
            }
        } else {
            Log.d(LOG_TAG, "Received permission callback for unknown request code");
        }
    }

    private String getMimeType(Uri uri) {
        String fileExtensionFromUrl = MimeTypeMap.getFileExtensionFromUrl(uri.toString()).toLowerCase();
        return MimeTypeMap.getSingleton().getMimeTypeFromExtension(fileExtensionFromUrl);
    }

    public ServicePathHandler getPathHandler() {
        final ResourceApi resourceApi = webView.getResourceApi();

        WebViewAssetLoader.PathHandler pathHandler = path -> {
            String targetFileSystem = null;

            if (path.startsWith(LocalFilesystemURL.fsNameToCdvKeyword("persistent"))) {
                targetFileSystem = "persistent";
            } else if (path.startsWith(LocalFilesystemURL.fsNameToCdvKeyword("temporary"))) {
                targetFileSystem = "temporary";
            } else if (path.startsWith(LocalFilesystemURL.fsNameToCdvKeyword("files"))) {
                targetFileSystem = "files";
            } else if (path.startsWith(LocalFilesystemURL.fsNameToCdvKeyword("documents"))) {
                targetFileSystem = "documents";
            } else if (path.startsWith(LocalFilesystemURL.fsNameToCdvKeyword("cache"))) {
                targetFileSystem = "cache";
            } else if (path.startsWith(LocalFilesystemURL.fsNameToCdvKeyword("root"))) {
                targetFileSystem = "root";
            } else if (path.startsWith(LocalFilesystemURL.fsNameToCdvKeyword("files-external"))) {
                targetFileSystem = "files-external";
            } else if (path.startsWith(LocalFilesystemURL.fsNameToCdvKeyword("sdcard"))) {
                targetFileSystem = "sdcard";
            } else if (path.startsWith(LocalFilesystemURL.fsNameToCdvKeyword("cache-external"))) {
                targetFileSystem = "cache-external";
            } else if (path.startsWith(LocalFilesystemURL.fsNameToCdvKeyword("assets"))) {
                targetFileSystem = "assets";
            } else if (path.startsWith(LocalFilesystemURL.fsNameToCdvKeyword("content"))) {
                targetFileSystem = "content";
            }

            boolean isAssetsFS = "assets".equals(targetFileSystem);

            if (targetFileSystem != null) {
                // Loop the registered file systems to find the target.
                for (Filesystem fileSystem : filesystems) {
                    /*
                     * When target is discovered:
                     * 1. Transform the url path to the native path
                     * 2. Load the file contents
                     * 3. Get the file mime type
                     * 4. Return the file & mime information back we Web Resources
                     */
                    if (fileSystem.name.equals(targetFileSystem)) {
                        // E.g. replace __cdvfile_persistent__ with native path "/data/user/0/com.example.file/files/files/"

                        if ("content".equals(targetFileSystem)) {
                            // The WebviewAssetLoader uses getPath API, which gives us a decoded path
                            // For content paths however, we need it to remain encoded.
                            // The Uri.encode API will encode forward slashes, therefore we must
                            // split the path, encode each segment, and rebuild the path
                            String[] pathParts = path.split("/");
                            path = "";
                            for (String part : pathParts) {
                                if ("".equals(path)) {
                                    path = Uri.encode(part);
                                }
                                else {
                                    path += "/" + Uri.encode(part);
                                }
                            }
                        }

                        String fileSystemNativeUri = fileSystem.rootUri.toString().replace("file://", "");
                        String fileTarget = path.replace(LocalFilesystemURL.fsNameToCdvKeyword(targetFileSystem) + "/", fileSystemNativeUri);

                        if (isAssetsFS) {
                            fileTarget = fileTarget.replace("/android_asset/", "");
                        }

                        Uri fileUri = "file".equals(fileSystem.rootUri.getScheme())
                            ? Uri.fromFile(new File(fileTarget))
                            : Uri.parse(fileTarget);
                        String mimeType = null;

                        try {
                            InputStream io = null;
                            if (isAssetsFS) {
                                io = webView.getContext().getAssets().open(fileTarget);
                                mimeType = getMimeType(fileUri);
                            } else {
                                if (fileUri.getScheme() == null) {
                                    fileUri = Uri.parse(fileSystem.rootUri.getScheme() + "://" + fileUri.getPath());
                                }
                                ResourceApi.OpenForReadResult resource = resourceApi.openForRead(fileUri);
                                io = resource.inputStream;
                                mimeType = resource.mimeType;
                            }

                            return new WebResourceResponse(mimeType, null, io);
                        } catch (FileNotFoundException e) {
                            Log.e(LOG_TAG, e.getMessage());
                        } catch (IOException e) {
                            Log.e(LOG_TAG, e.getMessage());
                        }
                    }
                }
            }

            return null;
        };

        return new ServicePathHandler(pathHandler);
    }
}

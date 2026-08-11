package com.foxdebug.acode.rk.plugin;

import org.apache.cordova.CallbackContext;
import org.apache.cordova.CordovaPlugin;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.UUID;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import android.content.Context;
import android.net.Uri;
import org.apache.cordova.*;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

//auth plugin
import com.foxdebug.acode.rk.auth.EncryptedPreferenceManager;

public class Tee extends CordovaPlugin {

    private static final int MAX_ARCHIVE_ENTRIES = 16 * 1024;
    private static final long MAX_ARCHIVE_BYTES = 512L * 1024 * 1024;
    private static final long MAX_ENTRY_BYTES = 128L * 1024 * 1024;
    private static final int BUFFER_SIZE = 32 * 1024;
    private static final Set<String> activeExtractions = ConcurrentHashMap.newKeySet();

    // pluginId : token
    private /*static*/ final Map<String, String> tokenStore = new ConcurrentHashMap<>();

    //assigned tokens
    private /*static*/ final Set<String> disclosed = ConcurrentHashMap.newKeySet();

    // token : list of permissions
    private /*static*/ final Map<String, List<String>> permissionStore = new ConcurrentHashMap<>();



    private Context context;


    public void initialize(CordovaInterface cordova, CordovaWebView webView) {
        super.initialize(cordova, webView);
        this.context = cordova.getContext();
    }

    @Override
    public boolean execute(String action, JSONArray args, CallbackContext callback)
            throws JSONException {

        if ("extractPluginArchive".equals(action)) {
            extractPluginArchive(args.getString(0), args.getString(1), args.getString(2), callback);
            return true;
        }


        if ("get_secret".equals(action)) {
            String token = args.getString(0);
            String key = args.getString(1);
            String defaultValue = args.getString(2);

            String pluginId = getPluginIdFromToken(token);

            if (pluginId == null) {
                callback.error("INVALID_TOKEN");
                return true;
            }

            EncryptedPreferenceManager prefs =
                    new EncryptedPreferenceManager(context, pluginId);

            String value = prefs.getString(key, defaultValue);
            callback.success(value);
            return true;
        }

        if ("set_secret".equals(action)) {
            String token = args.getString(0);
            String key = args.getString(1);
            String value = args.getString(2);

            String pluginId = getPluginIdFromToken(token);

            if (pluginId == null) {
                callback.error("INVALID_TOKEN");
                return true;
            }

            EncryptedPreferenceManager prefs =
                    new EncryptedPreferenceManager(context, pluginId);

            prefs.setString(key, value);
            callback.success();
            return true;
        }


        if ("requestToken".equals(action)) {
            String pluginId = args.getString(0);
            String pluginJson = args.getString(1);
            handleTokenRequest(pluginId, pluginJson, callback);
            return true;
        }

        if ("grantedPermission".equals(action)) {
            String token = args.getString(0);
            String permission = args.getString(1);

            if (!permissionStore.containsKey(token)) {
                callback.error("INVALID_TOKEN");
                return true;
            }

            boolean granted = grantedPermission(token, permission);
            callback.success(granted ? 1 : 0);
            return true;
        }

        if ("listAllPermissions".equals(action)) {
            String token = args.getString(0);

            if (!permissionStore.containsKey(token)) {
                callback.error("INVALID_TOKEN");
                return true;
            }

            List<String> permissions = listAllPermissions(token);
            JSONArray result = new JSONArray(permissions);

            callback.success(result);
            return true;
        }

        return false;
    }

    /**
     * Extract a downloaded archive in native code. The previous plugin is kept
     * in place until all archive entries have been streamed to a sibling
     * staging directory and the directory swap succeeds.
     */
    private void extractPluginArchive(
            final String archiveUri,
            final String destinationUri,
            final String manifest,
            final CallbackContext callback
    ) {
        cordova.getThreadPool().execute(new Runnable() {
            @Override
            public void run() {
                File staging = null;
                File backup = null;
                File destination = null;
                String destinationPath = null;
                try {
                    File archive = webView.getResourceApi().mapUriToFile(Uri.parse(archiveUri));
                    destination = webView.getResourceApi().mapUriToFile(Uri.parse(destinationUri));
                    if (archive == null || !archive.isFile()) {
                        throw new IOException("Plugin archive is unavailable");
                    }
                    if (destination == null || destination.getParentFile() == null) {
                        throw new IOException("Plugin destination is unavailable");
                    }

                    File parent = destination.getParentFile().getCanonicalFile();
                    destination = destination.getCanonicalFile();
                    if (!destination.getParentFile().equals(parent)) {
                        throw new IOException("Invalid plugin destination");
                    }
                    if (!parent.exists() && !parent.mkdirs()) {
                        throw new IOException("Unable to create plugin directory");
                    }
                    destinationPath = destination.getPath();
                    if (!activeExtractions.add(destinationPath)) {
                        throw new IOException("Plugin installation is already in progress");
                    }

                    restoreInterruptedInstall(parent, destination);

                    staging = new File(
                            parent,
                            "." + destination.getName() + ".install-" + UUID.randomUUID()
                    );
                    if (!staging.mkdirs()) {
                        throw new IOException("Unable to create plugin staging directory");
                    }

                    extractArchive(archive, staging);
                    writeManifest(staging, manifest);

                    if (destination.exists()) {
                        backup = new File(
                                parent,
                                "." + destination.getName() + ".backup-" + UUID.randomUUID()
                        );
                        if (!destination.renameTo(backup)) {
                            throw new IOException("Unable to stage existing plugin");
                        }
                    }

                    if (!staging.renameTo(destination)) {
                        if (backup != null && backup.exists()) {
                            backup.renameTo(destination);
                        }
                        throw new IOException("Unable to activate plugin");
                    }
                    staging = null;

                    if (backup != null) {
                        deleteRecursively(backup);
                    }
                    callback.success();
                } catch (Exception error) {
                    callback.error(error.getMessage() == null ? "Plugin extraction failed" : error.getMessage());
                } finally {
                    if (staging != null) {
                        deleteRecursively(staging);
                    }
                    if (backup != null && backup.exists() && destination != null && !destination.exists()) {
                        backup.renameTo(destination);
                    }
                    if (destinationPath != null) {
                        activeExtractions.remove(destinationPath);
                    }
                }
            }
        });
    }

    private static void extractArchive(File archive, File destination) throws IOException {
        String destinationPath = destination.getCanonicalPath() + File.separator;
        int entryCount = 0;
        long extractedBytes = 0;
        boolean hasManifest = false;
        byte[] buffer = new byte[BUFFER_SIZE];

        try (ZipInputStream input = new ZipInputStream(
                new BufferedInputStream(new FileInputStream(archive))
        )) {
            ZipEntry entry;
            while ((entry = input.getNextEntry()) != null) {
                entryCount += 1;
                if (entryCount > MAX_ARCHIVE_ENTRIES) {
                    throw new IOException("Plugin archive contains too many files");
                }

                String name = entry.getName().replace('\\', '/');
                if (name.isEmpty() || name.startsWith("/") || name.matches("^[A-Za-z]:/.*") || name.indexOf('\0') >= 0) {
                    throw new IOException("Plugin archive contains an unsafe path");
                }

                File output = new File(destination, name).getCanonicalFile();
                if (!output.getPath().startsWith(destinationPath)) {
                    throw new IOException("Plugin archive attempts to write outside its directory");
                }
                if ("plugin.json".equals(name)) {
                    hasManifest = true;
                }

                if (entry.isDirectory()) {
                    if (!output.mkdirs() && !output.isDirectory()) {
                        throw new IOException("Unable to create plugin directory");
                    }
                    input.closeEntry();
                    continue;
                }

                long declaredSize = entry.getSize();
                if (declaredSize > MAX_ENTRY_BYTES) {
                    throw new IOException("Plugin archive contains an oversized file");
                }
                File outputParent = output.getParentFile();
                if (!outputParent.exists() && !outputParent.mkdirs()) {
                    throw new IOException("Unable to create plugin directory");
                }

                long entryBytes = 0;
                try (BufferedOutputStream outputStream = new BufferedOutputStream(
                        new FileOutputStream(output)
                )) {
                    int count;
                    while ((count = input.read(buffer)) != -1) {
                        entryBytes += count;
                        extractedBytes += count;
                        if (entryBytes > MAX_ENTRY_BYTES || extractedBytes > MAX_ARCHIVE_BYTES) {
                            throw new IOException("Plugin archive is too large");
                        }
                        outputStream.write(buffer, 0, count);
                    }
                }
                input.closeEntry();
            }
        }

        if (!hasManifest) {
            throw new IOException("Plugin archive is missing plugin.json");
        }
    }

    private static void writeManifest(File destination, String manifest) throws IOException {
        try (FileOutputStream output = new FileOutputStream(new File(destination, "plugin.json"))) {
            output.write(manifest.getBytes(StandardCharsets.UTF_8));
        }
    }

    /**
     * A directory rename cannot be made atomic with replacing an existing
     * directory. If Android stops the app between the two renames, restore the
     * most recent backup before beginning another installation.
     */
    private static void restoreInterruptedInstall(File parent, File destination) throws IOException {
        String backupPrefix = "." + destination.getName() + ".backup-";
        File[] children = parent.listFiles();
        if (children == null) return;

        File newestBackup = null;
        for (File child : children) {
            if (!child.isDirectory() || !child.getName().startsWith(backupPrefix)) continue;
            if (newestBackup == null || child.lastModified() > newestBackup.lastModified()) {
                newestBackup = child;
            }
        }

        if (!destination.exists() && newestBackup != null) {
            if (!newestBackup.renameTo(destination)) {
                throw new IOException("Unable to restore previous plugin installation");
            }
        }

        for (File child : children) {
            if (child.isDirectory() && child.getName().startsWith(backupPrefix)) {
                deleteRecursively(child);
            }
        }
    }

    private static void deleteRecursively(File file) {
        if (file == null || !file.exists()) return;
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children != null) {
                for (File child : children) {
                    deleteRecursively(child);
                }
            }
        }
        file.delete();
    }


    private String getPluginIdFromToken(String token) {
        for (Map.Entry<String, String> entry : tokenStore.entrySet()) {
            if (entry.getValue().equals(token)) {
                return entry.getKey();
            }
        }
        return null;
    }

    //============================================================
    //do not change function signatures
    public boolean isTokenValid(String token, String pluginId) {
        String storedToken = tokenStore.get(pluginId);
        return storedToken != null && token.equals(storedToken);
    }


    public boolean grantedPermission(String token, String permission) {
        List<String> permissions = permissionStore.get(token);
        return permissions != null && permissions.contains(permission);
    }

    public List<String> listAllPermissions(String token) {
        List<String> permissions = permissionStore.get(token);

        if (permissions == null) {
            return new ArrayList<>();
        }

        return new ArrayList<>(permissions); // return copy (safe)
    }
    //============================================================


    private synchronized void handleTokenRequest(
            String pluginId,
            String pluginJson,
            CallbackContext callback
    ) {

        if (disclosed.contains(pluginId)) {
            callback.error("TOKEN_ALREADY_ISSUED");
            return;
        }

        String token = tokenStore.get(pluginId);

        if (token == null) {
            token = UUID.randomUUID().toString();
            tokenStore.put(pluginId, token);
        }

        try {
            JSONObject json = new JSONObject(pluginJson);
            JSONArray permissions = json.optJSONArray("permissions");

            List<String> permissionList = new ArrayList<>();

            if (permissions != null) {
                for (int i = 0; i < permissions.length(); i++) {
                    permissionList.add(permissions.getString(i));
                }
            }

            // Bind permissions to token
            permissionStore.put(token, permissionList);

        } catch (JSONException e) {
            callback.error("INVALID_PLUGIN_JSON");
            return;
        }

        disclosed.add(pluginId);
        callback.success(token);
    }
}

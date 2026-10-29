package com.foxdebug.acode.rk.plugin;

import org.apache.cordova.CallbackContext;
import org.apache.cordova.CordovaPlugin;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import android.content.Context;
import org.apache.cordova.*;

//auth plugin
import com.foxdebug.acode.rk.auth.EncryptedPreferenceManager;

public class Tee extends CordovaPlugin {

    // pluginId : token
    private final Map<String, String> tokenStore = new ConcurrentHashMap<>();

    // token : list of permissions
    private final Map<String, List<String>> permissionStore = new ConcurrentHashMap<>();

    // Trusted session established by the plugin loader before any plugin runs.
    // Only requests carrying this secret are allowed to request tokens.
    private volatile String sessionId = null;

    // Cryptographically secure source for all secrets. Tokens must never be
    // predictable or derivable, otherwise a malicious plugin could forge them.
    private static final SecureRandom SECURE_RANDOM = new SecureRandom();

    private Context context;


    public void initialize(CordovaInterface cordova, CordovaWebView webView) {
        super.initialize(cordova, webView);
        this.context = cordova.getContext();
    }

    @Override
    public void onReset() {
        // The WebView navigated/refreshed: the JS world was rebuilt, so the
        // previous trusted session is no longer meaningful. Drop it and let the
        // loader establish a fresh one during the next bootstrap.
        this.sessionId = null;
    }

    @Override
    public boolean execute(String action, JSONArray args, CallbackContext callback)
            throws JSONException {

        if ("establishConnection".equals(action)) {
            synchronized (this) {
                if (sessionId != null) {
                    callback.error("CONNECTION_ALREADY_ESTABLISHED");
                } else {
                    sessionId = generateSecret();
                    callback.success(sessionId);
                }
            }
            return true;
        }

        if ("requestToken".equals(action)) {
            String session = args.getString(0);
            String pluginId = args.getString(1);
            String pluginJson = args.getString(2);

            if (!isValidSession(session)) {
                callback.error("INVALID_SESSION");
                return true;
            }

            handleTokenRequest(pluginId, pluginJson, callback);
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

        if ("delete_secret".equals(action)) {
            String token = args.getString(0);
            String key = args.getString(1);

            String pluginId = getPluginIdFromToken(token);

            if (pluginId == null) {
                callback.error("INVALID_TOKEN");
                return true;
            }

            EncryptedPreferenceManager prefs =
                    new EncryptedPreferenceManager(context, pluginId);

            prefs.remove(key);
            callback.success();
            return true;
        }

        if ("clear_all_secrets".equals(action)) {
            String token = args.getString(0);

            String pluginId = getPluginIdFromToken(token);

            if (pluginId == null) {
                callback.error("INVALID_TOKEN");
                return true;
            }

            EncryptedPreferenceManager prefs =
                    new EncryptedPreferenceManager(context, pluginId);

            prefs.clear();
            callback.success();
            return true;
        }


        if ("invalidate".equals(action)) {
            String token = args.getString(0);

            String pluginId = getPluginIdFromToken(token);

            if (pluginId == null) {
                callback.error("INVALID_TOKEN");
                return true;
            }

            invalidateToken(token, pluginId);
            callback.success();
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


    private String getPluginIdFromToken(String token) {
        for (Map.Entry<String, String> entry : tokenStore.entrySet()) {
            if (constantTimeEquals(token, entry.getValue())) {
                return entry.getKey();
            }
        }
        return null;
    }

    private void invalidateToken(String token, String pluginId) {
        String storedToken = tokenStore.get(pluginId);
        if (storedToken != null && constantTimeEquals(token, storedToken)) {
            tokenStore.remove(pluginId);
        }
        permissionStore.remove(token);
    }

    private boolean isValidSession(String session) {
        String current = sessionId;
        return current != null && constantTimeEquals(session, current);
    }

    //============================================================
    //do not change function signatures
    public boolean isTokenValid(String token, String pluginId) {
        String storedToken = tokenStore.get(pluginId);
        return storedToken != null && constantTimeEquals(token, storedToken);
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

        String token = tokenStore.get(pluginId);

        if (token == null) {
            token = generateSecret();
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

        callback.success(token);
    }

    /**
     * Generates a 256-bit (32-byte) secret encoded as hex. Uses SecureRandom so
     * tokens and session ids are never predictable, derivable or forgeable.
     */
    private static String generateSecret() {
        byte[] bytes = new byte[32];
        SECURE_RANDOM.nextBytes(bytes);
        return toHex(bytes);
    }

    private static String toHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) {
            sb.append(Character.forDigit((b >> 4) & 0xF, 16));
            sb.append(Character.forDigit(b & 0xF, 16));
        }
        return sb.toString();
    }

    private static boolean constantTimeEquals(String a, String b) {
        if (a == null || b == null) {
            return false;
        }
        return MessageDigest.isEqual(
                a.getBytes(StandardCharsets.UTF_8),
                b.getBytes(StandardCharsets.UTF_8)
        );
    }
}

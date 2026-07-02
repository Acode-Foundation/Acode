package com.foxdebug.acode.rk.auth;

import android.content.Intent;
import android.net.Uri;
import android.util.Log;
import android.webkit.CookieManager;
import android.webkit.WebView;
import androidx.browser.customtabs.CustomTabsIntent;
import com.foxdebug.acode.rk.auth.EncryptedPreferenceManager;
import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import org.apache.cordova.*;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

public class Authenticator extends CordovaPlugin {
    private static final String TAG = "AcodeAuth";
    private static final String PREFS_FILENAME = "acode_auth_secure";
    private static final String KEY_TOKEN = "auth_token";
    private static final String PRO_PURCHASED = "pro_purchased";
    private static final String KEY_MIGRATED_V2 = "migrated_host_to_domain_cookies";
    private static final String KEY_PENDING_STATE = "pending_login_state";
    private static final String KEY_PENDING_VERIFIER = "pending_login_verifier";
    private static final String KEY_PENDING_BASE_URL = "pending_login_base_url";
    private static final int AUTH_CONNECT_TIMEOUT_MS = 15_000;
    private static final int AUTH_READ_TIMEOUT_MS = 30_000;
    private static final String[] API_ORIGINS = {
        "https://acode.app"
    };
    private static final String[] LEGACY_ORIGINS = {
        "https://acode.app",
        "https://dev.acode.app"
    };
    private EncryptedPreferenceManager prefManager;
    private final Object loginCallbackLock = new Object();
    private volatile CallbackContext loginCallback;

    @Override
    protected void pluginInitialize() {
        Log.d(TAG, "Initializing Authenticator Plugin...");
        this.prefManager = new EncryptedPreferenceManager(this.cordova.getContext(), PREFS_FILENAME);

        WebView androidWebView = (WebView) webView.getView();
        CookieManager.getInstance().setAcceptThirdPartyCookies(androidWebView, true);

        if (!prefManager.getBoolean(KEY_MIGRATED_V2, false)) {
            Log.d(TAG, "Migrating: clearing legacy host-scoped cookies");
            clearLegacyCookies();
            prefManager.setBoolean(KEY_MIGRATED_V2, true);
        }

        String token = prefManager.getString(KEY_TOKEN, "");
        if (!token.isEmpty()) {
            setTokenCookie(token);
        }

        handleAuthCallback(cordova.getActivity().getIntent());
    }

    @Override
    public boolean execute(String action, JSONArray args, CallbackContext callbackContext) throws JSONException {
        Log.i(TAG, "Native Action Called: " + action);

        switch (action) {
            case "logout":
                prefManager.remove(KEY_TOKEN);
                cordova.getActivity().runOnUiThread(() -> clearTokenCookie());
                if (callbackContext != null) callbackContext.success();
                return true;
            case "saveToken":
                String token = args.getString(0);
                Log.d(TAG, "Saving new token...");
                prefManager.setString(KEY_TOKEN, token);
                cordova.getActivity().runOnUiThread(() -> setTokenCookie(token));
                callbackContext.success();
                return true;
            case "login":
                JSONObject options = args.optJSONObject(0);
                startLogin(options != null ? options : new JSONObject(), callbackContext);
                return true;
            default:
                Log.w(TAG, "Attempted to call unknown action: " + action);
                return false;
        }
    }

    @Override
    public void onNewIntent(Intent intent) {
        if (!handleAuthCallback(intent)) {
            super.onNewIntent(intent);
        }
    }

    private void startLogin(JSONObject options, CallbackContext callbackContext) {
        String baseUrl = options.optString("baseUrl", "https://acode.app");
        int appVersionCode = options.optInt("appVersionCode", 0);
        String state = randomHex(24);
        String verifier = randomHex(32);
        String challenge = sha256Hex(verifier);

        prefManager.setString(KEY_PENDING_STATE, state);
        prefManager.setString(KEY_PENDING_VERIFIER, verifier);
        prefManager.setString(KEY_PENDING_BASE_URL, baseUrl);
        setLoginCallback(callbackContext);

        Uri loginUri = Uri.parse(baseUrl)
            .buildUpon()
            .appendEncodedPath("login")
            .appendQueryParameter("redirect", "app")
            .appendQueryParameter("authFlow", "app-code")
            .appendQueryParameter("state", state)
            .appendQueryParameter("challenge", challenge)
            .appendQueryParameter("appVersionCode", String.valueOf(appVersionCode))
            .build();

        cordova.getActivity().runOnUiThread(() -> {
            try {
                CustomTabsIntent customTabsIntent = new CustomTabsIntent.Builder().build();
                customTabsIntent.intent.putExtra(CustomTabsIntent.EXTRA_TITLE_VISIBILITY_STATE, CustomTabsIntent.SHOW_PAGE_TITLE);
                customTabsIntent.launchUrl(cordova.getActivity(), loginUri);

                PluginResult result = new PluginResult(PluginResult.Status.NO_RESULT);
                result.setKeepCallback(true);
                callbackContext.sendPluginResult(result);
            } catch (Exception error) {
                Intent fallback = new Intent(Intent.ACTION_VIEW, loginUri);
                try {
                    cordova.getActivity().startActivity(fallback);
                    PluginResult result = new PluginResult(PluginResult.Status.NO_RESULT);
                    result.setKeepCallback(true);
                    callbackContext.sendPluginResult(result);
                } catch (Exception fallbackError) {
                    failLogin(fallbackError.getMessage());
                }
            }
        });
    }

    private boolean handleAuthCallback(Intent intent) {
        Uri data = intent != null ? intent.getData() : null;
        if (data == null || !"acode".equals(data.getScheme()) || !"auth".equals(data.getHost()) || !"/callback".equals(data.getPath())) {
            return false;
        }

        String code = data.getQueryParameter("code");
        String state = data.getQueryParameter("state");
        String expectedState = prefManager.getString(KEY_PENDING_STATE, "");
        String verifier = prefManager.getString(KEY_PENDING_VERIFIER, "");
        String baseUrl = prefManager.getString(KEY_PENDING_BASE_URL, "https://acode.app");

        if (code == null || state == null || expectedState.isEmpty() || verifier.isEmpty() || !expectedState.equals(state)) {
            failLogin("Invalid login callback");
            return true;
        }

        cordova.getThreadPool().execute(() -> {
            try {
                String token = exchangeCode(baseUrl, code, state, verifier);
                prefManager.setString(KEY_TOKEN, token);
                prefManager.remove(KEY_PENDING_STATE);
                prefManager.remove(KEY_PENDING_VERIFIER);
                prefManager.remove(KEY_PENDING_BASE_URL);
                cordova.getActivity().runOnUiThread(() -> setTokenCookie(token));
                CallbackContext callback = takeLoginCallback();
                if (callback != null) {
                    callback.success();
                }
            } catch (Exception error) {
                Log.e(TAG, "Failed to exchange app auth code", error);
                failLogin("Unable to complete login");
            }
        });

        return true;
    }

    private String exchangeCode(String baseUrl, String code, String state, String verifier) throws Exception {
        URL url = new URL(baseUrl + "/api/user/app-token/exchange");
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        try {
            connection.setConnectTimeout(AUTH_CONNECT_TIMEOUT_MS);
            connection.setReadTimeout(AUTH_READ_TIMEOUT_MS);
            connection.setRequestMethod("POST");
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setDoOutput(true);

            JSONObject body = new JSONObject();
            body.put("code", code);
            body.put("state", state);
            body.put("verifier", verifier);

            try (OutputStream os = connection.getOutputStream()) {
                os.write(body.toString().getBytes(StandardCharsets.UTF_8));
            }

            int status = connection.getResponseCode();
            InputStream stream = status >= 200 && status < 300 ? connection.getInputStream() : connection.getErrorStream();
            String response = readStream(stream);

            if (status < 200 || status >= 300) {
                throw new IllegalStateException(response);
            }

            JSONObject json = new JSONObject(response);
            String token = json.optString("token", "");
            if (token.isEmpty()) {
                throw new IllegalStateException("Missing token");
            }

            return token;
        } finally {
            connection.disconnect();
        }
    }

    private String readStream(InputStream stream) throws Exception {
        if (stream == null) return "";
        StringBuilder builder = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                builder.append(line);
            }
        }
        return builder.toString();
    }

    private void failLogin(String message) {
        prefManager.remove(KEY_PENDING_STATE);
        prefManager.remove(KEY_PENDING_VERIFIER);
        prefManager.remove(KEY_PENDING_BASE_URL);
        CallbackContext callback = takeLoginCallback();
        if (callback != null) {
            callback.error(message);
        }
    }

    private void setLoginCallback(CallbackContext callbackContext) {
        CallbackContext previousCallback = null;
        synchronized (loginCallbackLock) {
            previousCallback = loginCallback;
            loginCallback = callbackContext;
        }
        if (previousCallback != null) {
            previousCallback.error("Login cancelled");
        }
    }

    private CallbackContext takeLoginCallback() {
        synchronized (loginCallbackLock) {
            CallbackContext callback = loginCallback;
            loginCallback = null;
            return callback;
        }
    }

    private String randomHex(int byteCount) {
        byte[] bytes = new byte[byteCount];
        new SecureRandom().nextBytes(bytes);
        StringBuilder builder = new StringBuilder(byteCount * 2);
        for (byte b : bytes) {
            builder.append(String.format("%02x", b));
        }
        return builder.toString();
    }

    private String sha256Hex(String value) {
        try {
            byte[] hash = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder builder = new StringBuilder(hash.length * 2);
            for (byte b : hash) {
                builder.append(String.format("%02x", b));
            }
            return builder.toString();
        } catch (Exception error) {
            throw new IllegalStateException("Unable to create auth challenge", error);
        }
    }

    private void setTokenCookie(String token) {
        CookieManager cm = CookieManager.getInstance();
        for (String origin : API_ORIGINS) {
            cm.setCookie(origin, "token=" + token + "; Domain=.acode.app; Path=/; Secure; HttpOnly; SameSite=None");
        }
        cm.flush();
    }

    private void clearTokenCookie() {
        CookieManager cm = CookieManager.getInstance();
        for (String origin : API_ORIGINS) {
            cm.setCookie(origin, "token=; Domain=.acode.app; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=None");
        }
        cm.flush();
    }

    private void clearLegacyCookies() {
        CookieManager cm = CookieManager.getInstance();
        for (String origin : LEGACY_ORIGINS) {
            cm.setCookie(origin, "token=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=None");
        }
        cm.flush();
    }
}

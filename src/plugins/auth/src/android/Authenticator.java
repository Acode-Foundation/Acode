package com.foxdebug.acode.rk.auth;

import android.util.Log;
import android.webkit.CookieManager;
import android.webkit.WebView;
import com.foxdebug.acode.rk.auth.EncryptedPreferenceManager;
import org.apache.cordova.*;
import org.json.JSONArray;
import org.json.JSONException;

public class Authenticator extends CordovaPlugin {
    private static final String TAG = "AcodeAuth";
    private static final String PREFS_FILENAME = "acode_auth_secure";
    private static final String KEY_TOKEN = "auth_token";
    private static final String[] API_ORIGINS = {
        "https://acode.app",
        "https://dev.acode.app"
    };
    private EncryptedPreferenceManager prefManager;

    @Override
    protected void pluginInitialize() {
        Log.d(TAG, "Initializing Authenticator Plugin...");
        this.prefManager = new EncryptedPreferenceManager(this.cordova.getContext(), PREFS_FILENAME);

        WebView androidWebView = (WebView) webView.getView();
        CookieManager.getInstance().setAcceptThirdPartyCookies(androidWebView, true);

        String token = prefManager.getString(KEY_TOKEN, "");
        if (!token.isEmpty()) {
            setTokenCookie(token);
        }
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
            default:
                Log.w(TAG, "Attempted to call unknown action: " + action);
                return false;
        }
    }

    private void setTokenCookie(String token) {
        CookieManager cm = CookieManager.getInstance();
        for (String origin : API_ORIGINS) {
            cm.setCookie(origin, "token=" + token + "; Path=/; Secure; HttpOnly; SameSite=None");
        }
        cm.flush();
    }

    private void clearTokenCookie() {
        CookieManager cm = CookieManager.getInstance();
        for (String origin : API_ORIGINS) {
            cm.setCookie(origin, "token=; Path=/; Max-Age=0");
        }
        cm.flush();
    }
}

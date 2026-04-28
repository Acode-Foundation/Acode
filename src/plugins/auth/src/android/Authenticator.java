package com.foxdebug.acode.rk.auth;

import android.util.Log;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.foxdebug.acode.rk.auth.EncryptedPreferenceManager;
import org.apache.cordova.*;
import org.json.JSONArray;
import org.json.JSONException;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Map;
import java.util.HashMap;
import java.util.List;

import org.apache.cordova.engine.SystemWebView;
import org.apache.cordova.engine.SystemWebViewClient;
import org.apache.cordova.engine.SystemWebViewEngine;

public class Authenticator extends CordovaPlugin {
    private static final String TAG = "AcodeAuth";
    private static final String PREFS_FILENAME = "acode_auth_secure";
    private static final String KEY_TOKEN = "auth_token";
    private EncryptedPreferenceManager prefManager;

    @Override
    protected void pluginInitialize() {
        Log.d(TAG, "Initializing Authenticator Plugin...");
        this.prefManager = new EncryptedPreferenceManager(this.cordova.getContext(), PREFS_FILENAME);

        SystemWebViewEngine engine = (SystemWebViewEngine) webView.getEngine();
        SystemWebView view = (SystemWebView) engine.getView();

        cordova.getActivity().runOnUiThread(() -> view.setWebViewClient(new SystemWebViewClient(engine) {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();

                if (url.startsWith("https://acode.app/api") || url.startsWith("https://dev.acode.app/api")) {
                    try {
                        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
                        conn.setRequestMethod(request.getMethod());

                        for (Map.Entry<String, String> header : request.getRequestHeaders().entrySet()) {
                            conn.setRequestProperty(header.getKey(), header.getValue());
                        }

                        String token = prefManager.getString(KEY_TOKEN, "");
                        if (!token.isEmpty()) {
                            conn.setRequestProperty("x-auth-token", token);
                        }

                        Map<String, String> responseHeaders = new HashMap<>();
                        for (Map.Entry<String, List<String>> entry : conn.getHeaderFields().entrySet()) {
                            List<String> values = entry.getValue();
                            if (entry.getKey() != null && !values.isEmpty()) {
                                responseHeaders.put(entry.getKey(), values.get(values.size() - 1));
                            }
                        }

                        return new WebResourceResponse(
                            conn.getContentType(),
                            conn.getContentEncoding(),
                            conn.getResponseCode(),
                            conn.getResponseMessage(),
                            responseHeaders,
                            conn.getInputStream()
                        );
                    } catch (Exception e) {
                        e.printStackTrace();
                    }
                }
                return super.shouldInterceptRequest(view, request);
            }
        }));
    }

    @Override
    public boolean execute(String action, JSONArray args, CallbackContext callbackContext) throws JSONException {
        Log.i(TAG, "Native Action Called: " + action);

        switch (action) {
            case "logout":
                prefManager.remove(KEY_TOKEN);
                if (callbackContext != null) callbackContext.success();
                return true;
            case "saveToken":
                String token = args.getString(0);
                Log.d(TAG, "Saving new token...");
                prefManager.setString(KEY_TOKEN, token);
                callbackContext.success();
                return true;
            default:
                Log.w(TAG, "Attempted to call unknown action: " + action);
                return false;
        }
    }
}

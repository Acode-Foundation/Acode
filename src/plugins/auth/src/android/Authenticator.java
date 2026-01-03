package com.foxdebug.acode.rk.auth;

import android.util.Log; // Required for logging
import com.foxdebug.acode.rk.auth.EncryptedPreferenceManager;
import org.apache.cordova.*;
import org.json.JSONArray;
import org.json.JSONException;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Scanner;

public class Authenticator extends CordovaPlugin {
    // Standard practice: use a TAG for easy filtering in Logcat
    private static final String TAG = "AcodeAuth"; 
    private static final String PREFS_FILENAME = "acode_auth_secure";
    private static final String KEY_TOKEN = "auth_token";
    private EncryptedPreferenceManager prefManager;

    @Override
    protected void pluginInitialize() {
        Log.d(TAG, "Initializing Authenticator Plugin...");
        this.prefManager = new EncryptedPreferenceManager(this.cordova.getContext(), PREFS_FILENAME);
    }

    @Override
    public boolean execute(String action, JSONArray args, CallbackContext callbackContext) throws JSONException {
        Log.i(TAG, "Native Action Called: " + action);
        
        switch (action) {
            case "logout":
                this.logout(callbackContext);
                return true;
            case "isLoggedIn":
                this.isLoggedIn(callbackContext);
                return true;
            case "getUserInfo":
                this.getUserInfo(callbackContext);
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

    private void logout(CallbackContext callbackContext) {
        Log.d(TAG, "Logging out, removing token.");
        prefManager.remove(KEY_TOKEN);
        if (callbackContext != null) callbackContext.success();
    }

    private void isLoggedIn(CallbackContext callbackContext) {
        String token = prefManager.getString(KEY_TOKEN, null);
        if (token == null) {
            Log.d(TAG, "isLoggedIn check: No token found in preferences.");
            callbackContext.error(0);
            return;
        }

        Log.d(TAG, "isLoggedIn check: Token found, validating with server...");
        final String tokenToValidate = token; // Make effectively final for lambda
        
        cordova.getThreadPool().execute(() -> {
            try {
                String result = validateToken(tokenToValidate); 
                if (result != null) {
                    Log.i(TAG, "Token validation successful.");
                    callbackContext.success(); 
                } else {
                    Log.w(TAG, "Token validation failed (result was null).");
                    callbackContext.error(401);
                }
            } catch (Exception e) {
                Log.e(TAG, "CRITICAL error in isLoggedIn thread: " + e.getMessage(), e);
                callbackContext.error("Internal Plugin Error: " + e.getMessage());
            }
        });
    }

    private void getUserInfo(CallbackContext callbackContext) {
        Log.d(TAG, "getUserInfo: Fetching token...");
        String token = prefManager.getString(KEY_TOKEN, null);
        
        if (token == null) {
            Log.e(TAG, "getUserInfo: No token found.");
            callbackContext.error(0);
            return;
        }
        
        final String tokenToValidate = token;
        cordova.getThreadPool().execute(() -> {
            try {
                String response = validateToken(tokenToValidate);
                if (response != null) {
                    Log.d(TAG, "getUserInfo: Successfully fetched user info.");
                    callbackContext.success(response);
                } else {
                    Log.e(TAG, "getUserInfo: Validation failed or unauthorized.");
                    callbackContext.error("Unauthorized");
                }
            } catch (Exception e) {
                Log.e(TAG, "Error in getUserInfo: " + e.getMessage(), e);
                callbackContext.error("Error: " + e.getMessage());
            }
        });
    }

    private String validateToken(String token) {
        HttpURLConnection conn = null;
        try {
            Log.d(TAG, "Network Request: Connecting to https://acode.app/api/login");
            URL url = new URL("https://acode.app/api/login");  // Changed from /api to /api/login
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestProperty("x-auth-token", token);
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(5000);
            conn.setReadTimeout(5000);  // Add read timeout too
            
            int code = conn.getResponseCode();
            Log.d(TAG, "Server responded with status code: " + code);

            if (code == 200) {
                Scanner s = new Scanner(conn.getInputStream(), "UTF-8").useDelimiter("\\A");
                String response = s.hasNext() ? s.next() : "";
                Log.d(TAG, "Response received: " + response);  // Debug log
                return response;
            } else if (code == 401) {
                Log.w(TAG, "401 Unauthorized: Logging user out native-side.");
                logout(null);
            } else {
                Log.w(TAG, "Unexpected status code: " + code);
            }
        } catch (Exception e) {
            Log.e(TAG, "Network Exception in validateToken: " + e.getMessage(), e);
            e.printStackTrace();  // Print full stack trace for debugging
        } finally {
            if (conn != null) conn.disconnect();
        }
        return null;
    }

    
}
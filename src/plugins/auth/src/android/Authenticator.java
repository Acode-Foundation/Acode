package com.foxdebug.acode.rk.auth;

import android.util.Log; // Required for logging
import com.foxdebug.acode.rk.auth.EncryptedPreferenceManager;
import org.apache.cordova.*;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.Random;
import java.util.Scanner;

public class Authenticator extends CordovaPlugin {
    // Standard practice: use a TAG for easy filtering in Logcat
    private static final String TAG = "AcodeAuth"; 
    private static final String PREFS_FILENAME = "acode_auth_secure";
    private static final String KEY_TOKEN = "auth_token";
    private static final String ADS_PREFS_FILENAME = "ads";
    private static final String KEY_REWARD_STATE = "reward_state";
    private static final long ONE_HOUR_MS = 60L * 60L * 1000L;
    private static final long MAX_ACTIVE_PASS_MS = 10L * ONE_HOUR_MS;
    private static final int MAX_REDEMPTIONS_PER_DAY = 3;
    private EncryptedPreferenceManager prefManager;
    private EncryptedPreferenceManager adsPrefManager;

    @Override
    protected void pluginInitialize() {
        Log.d(TAG, "Initializing Authenticator Plugin...");
        this.prefManager = new EncryptedPreferenceManager(this.cordova.getContext(), PREFS_FILENAME);
        this.adsPrefManager = new EncryptedPreferenceManager(this.cordova.getContext(), ADS_PREFS_FILENAME);
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
            case "getRewardStatus":
                callbackContext.success(getRewardStatus());
                return true;
            case "redeemReward":
                callbackContext.success(redeemReward(args.getString(0)));
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

    private String getRewardStatus() throws JSONException {
        JSONObject state = syncRewardState(loadRewardState());
        JSONObject status = buildRewardStatus(state);

        if (status.optBoolean("hasPendingExpiryNotice")) {
            state.put("expiryNoticePendingUntil", 0);
        }

        saveRewardState(state);
        return status.toString();
    }

    private String redeemReward(String offerId) throws JSONException {
        JSONObject state = syncRewardState(loadRewardState());
        int redemptionsToday = state.optInt("redemptionsToday", 0);
        long now = System.currentTimeMillis();
        long adFreeUntil = state.optLong("adFreeUntil", 0);
        long remainingMs = Math.max(0L, adFreeUntil - now);

        if (redemptionsToday >= MAX_REDEMPTIONS_PER_DAY) {
            throw new JSONException(
                "Daily limit reached. You can redeem up to " + MAX_REDEMPTIONS_PER_DAY + " rewards per day."
            );
        }

        if (remainingMs >= MAX_ACTIVE_PASS_MS) {
            throw new JSONException("You already have the maximum 10 hours of ad-free time active.");
        }

        long grantedDurationMs = resolveRewardDuration(offerId);
        long baseTime = Math.max(now, adFreeUntil);
        long newAdFreeUntil = Math.min(baseTime + grantedDurationMs, now + MAX_ACTIVE_PASS_MS);
        long appliedDurationMs = Math.max(0L, newAdFreeUntil - baseTime);

        state.put("adFreeUntil", newAdFreeUntil);
        state.put("lastExpiredRewardUntil", 0);
        state.put("expiryNoticePendingUntil", 0);
        state.put("redemptionDay", getTodayKey());
        state.put("redemptionsToday", redemptionsToday + 1);
        saveRewardState(state);

        JSONObject status = buildRewardStatus(state);
        status.put("grantedDurationMs", grantedDurationMs);
        status.put("appliedDurationMs", appliedDurationMs);
        status.put("offerId", offerId);
        return status.toString();
    }

    private JSONObject loadRewardState() {
        String raw = adsPrefManager.getString(KEY_REWARD_STATE, "");
        if (raw == null || raw.isEmpty()) {
            return defaultRewardState();
        }

        try {
            JSONObject parsed = new JSONObject(raw);
            return mergeRewardState(parsed);
        } catch (JSONException error) {
            Log.w(TAG, "Failed to parse reward state, resetting.", error);
            return defaultRewardState();
        }
    }

    private JSONObject defaultRewardState() {
        JSONObject state = new JSONObject();
        try {
            state.put("adFreeUntil", 0L);
            state.put("lastExpiredRewardUntil", 0L);
            state.put("expiryNoticePendingUntil", 0L);
            state.put("redemptionDay", getTodayKey());
            state.put("redemptionsToday", 0);
        } catch (JSONException ignored) {
            // No-op; JSONObject puts for primitives should not fail in practice.
        }
        return state;
    }

    private JSONObject mergeRewardState(JSONObject parsed) {
        JSONObject state = defaultRewardState();
        try {
            state.put("adFreeUntil", parsed.optLong("adFreeUntil", 0L));
            state.put("lastExpiredRewardUntil", parsed.optLong("lastExpiredRewardUntil", 0L));
            state.put("expiryNoticePendingUntil", parsed.optLong("expiryNoticePendingUntil", 0L));
            state.put("redemptionDay", parsed.optString("redemptionDay", getTodayKey()));
            state.put("redemptionsToday", parsed.optInt("redemptionsToday", 0));
        } catch (JSONException ignored) {
            // Ignore and keep defaults.
        }
        return state;
    }

    private void saveRewardState(JSONObject state) {
        adsPrefManager.setString(KEY_REWARD_STATE, state.toString());
    }

    private JSONObject syncRewardState(JSONObject state) throws JSONException {
        String todayKey = getTodayKey();
        if (!todayKey.equals(state.optString("redemptionDay", todayKey))) {
            state.put("redemptionDay", todayKey);
            state.put("redemptionsToday", 0);
        }

        long adFreeUntil = state.optLong("adFreeUntil", 0L);
        long now = System.currentTimeMillis();
        if (adFreeUntil > 0L && adFreeUntil <= now) {
            if (state.optLong("expiryNoticePendingUntil", 0L) != adFreeUntil) {
                state.put("expiryNoticePendingUntil", adFreeUntil);
            }
            state.put("lastExpiredRewardUntil", adFreeUntil);
            state.put("adFreeUntil", 0L);
        }

        return state;
    }

    private JSONObject buildRewardStatus(JSONObject state) throws JSONException {
        long now = System.currentTimeMillis();
        long adFreeUntil = state.optLong("adFreeUntil", 0L);
        int redemptionsToday = state.optInt("redemptionsToday", 0);
        long remainingMs = Math.max(0L, adFreeUntil - now);
        int remainingRedemptions = Math.max(0, MAX_REDEMPTIONS_PER_DAY - redemptionsToday);

        JSONObject status = new JSONObject();
        status.put("adFreeUntil", adFreeUntil);
        status.put("lastExpiredRewardUntil", state.optLong("lastExpiredRewardUntil", 0L));
        status.put("isActive", adFreeUntil > now);
        status.put("remainingMs", remainingMs);
        status.put("redemptionsToday", redemptionsToday);
        status.put("remainingRedemptions", remainingRedemptions);
        status.put("maxRedemptionsPerDay", MAX_REDEMPTIONS_PER_DAY);
        status.put("maxActivePassMs", MAX_ACTIVE_PASS_MS);
        status.put("hasPendingExpiryNotice", state.optLong("expiryNoticePendingUntil", 0L) > 0L);
        status.put("expiryNoticePendingUntil", state.optLong("expiryNoticePendingUntil", 0L));

        boolean canRedeem = remainingRedemptions > 0 && remainingMs < MAX_ACTIVE_PASS_MS;
        status.put("canRedeem", canRedeem);
        status.put("redeemDisabledReason", getRedeemDisabledReason(remainingRedemptions, remainingMs));
        return status;
    }

    private String getRedeemDisabledReason(int remainingRedemptions, long remainingMs) {
        if (remainingRedemptions <= 0) {
            return "Daily limit reached. You can redeem up to " + MAX_REDEMPTIONS_PER_DAY + " rewards per day.";
        }
        if (remainingMs >= MAX_ACTIVE_PASS_MS) {
            return "You already have the maximum 10 hours of ad-free time active.";
        }
        return "";
    }

    private long resolveRewardDuration(String offerId) throws JSONException {
        if ("quick".equals(offerId)) {
            return ONE_HOUR_MS;
        }
        if ("focus".equals(offerId)) {
            int selectedHours = 4 + new Random().nextInt(3);
            return selectedHours * ONE_HOUR_MS;
        }
        throw new JSONException("Unknown reward offer.");
    }

    private String getTodayKey() {
        return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
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

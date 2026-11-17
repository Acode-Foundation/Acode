package com.foxdebug.acode.system;

import android.content.Context;
import android.util.Log;
import com.foxdebug.acode.auth.EncryptedPreferenceManager;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import org.json.JSONException;
import org.json.JSONObject;

public class RewardPassManager {
    private static final String TAG = "SystemRewardPass";
    private static final String ADS_PREFS_FILENAME = "ads";
    private static final String KEY_REWARD_STATE = "reward_state";
    private static final long ONE_HOUR_MS = 60L * 60L * 1000L;
    private static final long MAX_ACTIVE_PASS_MS = 10L * ONE_HOUR_MS;
    private static final int MAX_REDEMPTIONS_PER_DAY = 3;

    private final EncryptedPreferenceManager adsPrefManager;

    public RewardPassManager(Context context) {
        this.adsPrefManager = new EncryptedPreferenceManager(context, ADS_PREFS_FILENAME);
    }

    public String getRewardStatus() throws JSONException {
        String previous = adsPrefManager.getString(KEY_REWARD_STATE, "");
        JSONObject state = syncRewardState(loadRewardState(previous));
        JSONObject status = buildRewardStatus(state);

        if (status.optBoolean("hasPendingExpiryNotice")) {
            state.put("expiryNoticePendingUntil", 0L);
        }

        if (!RewardPassStorage.isUnchanged(previous, state)) saveRewardState(state);
        return status.toString();
    }

    private JSONObject loadRewardState(String raw) {
        if (raw == null || raw.isEmpty()) {
            return defaultRewardState();
        }

        try {
            return mergeRewardState(new JSONObject(raw));
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
        long now = java.lang.System.currentTimeMillis();
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
        long now = java.lang.System.currentTimeMillis();
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

        status.put("canRedeem", false);
        status.put("redeemDisabledReason", "Ad-free passes are no longer available.");
        return status;
    }

    private String getTodayKey() {
        return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
    }
}

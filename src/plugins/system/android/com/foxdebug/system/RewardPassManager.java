package com.foxdebug.system;

import android.content.Context;
import android.util.Log;
import com.foxdebug.acode.rk.auth.EncryptedPreferenceManager;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.Random;
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
    private final Random random = new Random();

    public RewardPassManager(Context context) {
        this.adsPrefManager = new EncryptedPreferenceManager(context, ADS_PREFS_FILENAME);
    }

    public String getRewardStatus() throws JSONException {
        JSONObject state = syncRewardState(loadRewardState());
        JSONObject status = buildRewardStatus(state);

        if (status.optBoolean("hasPendingExpiryNotice")) {
            state.put("expiryNoticePendingUntil", 0L);
        }

        saveRewardState(state);
        return status.toString();
    }

    public String redeemReward(String offerId) throws JSONException {
        JSONObject state = syncRewardState(loadRewardState());
        int redemptionsToday = state.optInt("redemptionsToday", 0);
        long now = java.lang.System.currentTimeMillis();
        long adFreeUntil = state.optLong("adFreeUntil", 0L);
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
        state.put("lastExpiredRewardUntil", 0L);
        state.put("expiryNoticePendingUntil", 0L);
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
            int selectedHours = 4 + random.nextInt(3);
            return selectedHours * ONE_HOUR_MS;
        }
        throw new JSONException("Unknown reward offer.");
    }

    private String getTodayKey() {
        return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
    }
}

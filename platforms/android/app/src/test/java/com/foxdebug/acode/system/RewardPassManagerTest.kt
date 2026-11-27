package com.foxdebug.acode.system

import com.foxdebug.acode.auth.EncryptedPreferenceManager
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(manifest = Config.NONE, sdk = [28])
class RewardPassManagerTest {
    @Test
    fun unchangedStatusPreservesJsonFormattingAndKeyOrder() {
        val context = RuntimeEnvironment.getApplication()
        val store = EncryptedPreferenceManager(context, "ads")
        val today = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US).format(java.util.Date())
        val raw = """{ "redemptionsToday": 2, "redemptionDay": "$today",
            "expiryNoticePendingUntil": 0, "lastExpiredRewardUntil": 0, "adFreeUntil": 0 }"""
        try {
            store.setString("reward_state", raw)
            RewardPassManager(context).getRewardStatus()
            assertEquals(raw, store.getString("reward_state", ""))
            assertFalse(RewardPassStorage.isUnchanged("invalid", JSONObject()))
            assertFalse(RewardPassStorage.isUnchanged("{}", JSONObject().put("adFreeUntil", 0L)))
        } finally {
            store.clear()
        }
    }

    @Test
    fun existingTimeSurvivesAndExpiryIsReportedOnceWithoutNewRedemptions() {
        val context = RuntimeEnvironment.getApplication()
        val store = EncryptedPreferenceManager(context, "ads")
        try {
            val expiry = java.lang.System.currentTimeMillis() + 3_600_000
            store.setString("reward_state", JSONObject().put("adFreeUntil", expiry).toString())
            val active = JSONObject(RewardPassManager(context).getRewardStatus())
            assertTrue(active.getBoolean("isActive"))
            assertFalse(active.getBoolean("canRedeem"))
            assertEquals(expiry, active.getLong("adFreeUntil"))

            val pastExpiry = java.lang.System.currentTimeMillis() - 1
            store.setString("reward_state", JSONObject().put("adFreeUntil", pastExpiry).toString())
            val rewards = RewardPassManager(context)
            val expired = JSONObject(rewards.getRewardStatus())
            assertFalse(expired.getBoolean("isActive"))
            assertFalse(expired.getBoolean("canRedeem"))
            assertTrue(expired.getBoolean("hasPendingExpiryNotice"))
            assertEquals(pastExpiry, expired.getLong("expiryNoticePendingUntil"))
            assertFalse(JSONObject(rewards.getRewardStatus()).getBoolean("hasPendingExpiryNotice"))
        } finally {
            store.clear()
        }
    }
}

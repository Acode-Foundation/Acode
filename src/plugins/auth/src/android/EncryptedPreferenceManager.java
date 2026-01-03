package com.foxdebug.acode.rk.auth;

import android.content.Context;
import android.content.SharedPreferences;
import androidx.security.crypto.EncryptedSharedPreferences;
import androidx.security.crypto.MasterKeys;
import java.io.IOException;
import java.security.GeneralSecurityException;

public class EncryptedPreferenceManager {
    private SharedPreferences sharedPreferences;

    /**
     * @param context  The Android Context
     * @param prefName The custom name for your preference file (e.g., "user_session")
     */
    public EncryptedPreferenceManager(Context context, String prefName) {
        try {
            String masterKeyAlias = MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC);

            // EncryptedSharedPreferences handles encryption of both Keys and Values
            sharedPreferences = EncryptedSharedPreferences.create(
                    prefName,
                    masterKeyAlias,
                    context,
                    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                    EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            );
        } catch (GeneralSecurityException | IOException e) {
            // Fallback to standard private preferences if hardware-backed encryption fails
            sharedPreferences = context.getSharedPreferences(prefName, Context.MODE_PRIVATE);
        }
    }

    // --- Reusable Methods ---

    public void setString(String key, String value) {
        sharedPreferences.edit().putString(key, value).apply();
    }

    public String getString(String key, String defaultValue) {
        return sharedPreferences.getString(key, defaultValue);
    }

    public void setInt(String key, int value) {
        sharedPreferences.edit().putInt(key, value).apply();
    }

    public int getInt(String key, int defaultValue) {
        return sharedPreferences.getInt(key, defaultValue);
    }

    public void remove(String key) {
        sharedPreferences.edit().remove(key).apply();
    }

    public boolean exists(String key) {
        return sharedPreferences.contains(key);
    }

    public void clear() {
        sharedPreferences.edit().clear().apply();
    }
}
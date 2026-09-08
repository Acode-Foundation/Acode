package com.foxdebug.acode.rk.auth;

import android.content.Context;
import android.content.SharedPreferences;
import androidx.security.crypto.EncryptedSharedPreferences;
import androidx.security.crypto.MasterKeys;
import java.io.IOException;
import java.security.GeneralSecurityException;

public class EncryptedPreferenceManager {
    private final SharedPreferences sharedPreferences;

    /**
     * @param context  The Android Context
     * @param prefName The custom name for your preference file (e.g., "user_session")
     */
    public EncryptedPreferenceManager(Context context, String prefName) {
        this(context, prefName, true);
    }

    /**
     * @param context                The Android Context
     * @param prefName               The custom name for your preference file
     * @param allowPlaintextFallback Whether storage may fall back to ordinary
     *                               SharedPreferences when encryption is unavailable
     */
    public EncryptedPreferenceManager(
            Context context,
            String prefName,
            boolean allowPlaintextFallback
    ) {
        SharedPreferences preferences;
        try {
            String masterKeyAlias = MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC);

            // EncryptedSharedPreferences handles encryption of both Keys and Values
            preferences = EncryptedSharedPreferences.create(
                    prefName,
                    masterKeyAlias,
                    context,
                    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                    EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            );
        } catch (GeneralSecurityException | IOException e) {
            if (!allowPlaintextFallback) {
                throw new IllegalStateException("Encrypted preferences are unavailable", e);
            }

            // Preserve the existing behavior for legacy callers unless strict mode is requested.
            preferences = context.getSharedPreferences(prefName, Context.MODE_PRIVATE);
        }
        sharedPreferences = preferences;
    }

    // --- Reusable Methods ---

    public void setString(String key, String value) {
        sharedPreferences.edit().putString(key, value).apply();
    }

    public boolean setStringSync(String key, String value) {
        return sharedPreferences.edit().putString(key, value).commit();
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

    public void setBoolean(String key, boolean value) {
        sharedPreferences.edit().putBoolean(key, value).apply();
    }

    public boolean getBoolean(String key, boolean defaultValue) {
        return sharedPreferences.getBoolean(key, defaultValue);
    }

    public void remove(String key) {
        sharedPreferences.edit().remove(key).apply();
    }

    public boolean removeSync(String key) {
        return sharedPreferences.edit().remove(key).commit();
    }

    public boolean exists(String key) {
        return sharedPreferences.contains(key);
    }

    public void clear() {
        sharedPreferences.edit().clear().apply();
    }
}

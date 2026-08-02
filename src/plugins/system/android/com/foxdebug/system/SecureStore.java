package com.foxdebug.system;

import android.content.Context;
import android.content.SharedPreferences;
import androidx.security.crypto.EncryptedSharedPreferences;
import androidx.security.crypto.MasterKeys;
import java.io.IOException;
import java.security.GeneralSecurityException;

/**
 * Small encrypted key/value store for secrets that must not sit in cleartext on
 * disk (e.g. saved SFTP/FTP server credentials, previously kept in the WebView's
 * localStorage.storageList). Values are encrypted at rest with a hardware-backed
 * master key via AndroidX Security-Crypto (AES256-GCM), the same mechanism the
 * auth plugin already uses for the account token.
 *
 * Lazily initialised so a crypto/keystore failure never blocks plugin startup.
 */
public class SecureStore {

    private static final String PREF_NAME = "acode_secure_store";

    private final Context context;
    private SharedPreferences prefs;

    public SecureStore(Context context) {
        this.context = context.getApplicationContext();
    }

    private SharedPreferences prefs() {
        if (prefs != null) return prefs;
        try {
            String masterKeyAlias = MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC);
            prefs = EncryptedSharedPreferences.create(
                PREF_NAME,
                masterKeyAlias,
                context,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            );
        } catch (GeneralSecurityException | IOException e) {
            // Same fallback the existing EncryptedPreferenceManager uses: a private
            // (app-sandbox) prefs file. Not encrypted, but still off the WebView's
            // localStorage and unreadable by other apps.
            prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
        }
        return prefs;
    }

    /** Store a value. Passing null removes the key. */
    public void set(String key, String value) {
        if (value == null) {
            remove(key);
            return;
        }
        prefs().edit().putString(key, value).apply();
    }

    /** Return the stored value, or null if absent. */
    public String get(String key) {
        return prefs().getString(key, null);
    }

    public void remove(String key) {
        prefs().edit().remove(key).apply();
    }

    public boolean contains(String key) {
        return prefs().contains(key);
    }
}

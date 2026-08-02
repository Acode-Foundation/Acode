package com.foxdebug.system;

import android.content.Context;
import android.content.SharedPreferences;
import androidx.security.crypto.EncryptedSharedPreferences;
import androidx.security.crypto.MasterKeys;
import java.io.IOException;
import java.security.GeneralSecurityException;

/**
 * Encrypted key/value store for secrets that must not sit in cleartext on disk
 * (saved FTP/SFTP credentials — see #2561). Backed by AndroidX Security-Crypto
 * (AES256-GCM values, AES256-SIV keys), the same mechanism the auth plugin uses
 * for the account token.
 *
 * If the encrypted store can't be opened (keystore/crypto failure), reads and
 * writes fail rather than falling back to plaintext. A plaintext fallback would
 * both re-introduce cleartext credentials and become unreadable once encryption
 * recovers — EncryptedSharedPreferences encrypts lookup keys, so a literal key
 * written in fallback mode can't be found again. Failing instead lets the caller
 * keep its source copy and retry on the next launch.
 */
public class SecureStore {

    private static final String PREF_NAME = "acode_secure_store";

    private final Context context;
    private SharedPreferences prefs;

    public SecureStore(Context context) {
        this.context = context.getApplicationContext();
    }

    /** The encrypted preferences, or null if encryption is currently unavailable. */
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
            prefs = null;
        }
        return prefs;
    }

    /**
     * Store a value durably. Passing null removes the key.
     * Uses commit() (not apply()) so the write is on disk before returning — the
     * JS migration deletes the legacy plaintext copy only after this reports
     * success.
     * @return true if the write reached disk; false if encryption is unavailable.
     */
    public boolean set(String key, String value) {
        if (value == null) {
            return remove(key);
        }
        SharedPreferences p = prefs();
        if (p == null) return false;
        return p.edit().putString(key, value).commit();
    }

    /** Return the stored value, or null if absent or encryption is unavailable. */
    public String get(String key) {
        SharedPreferences p = prefs();
        if (p == null) return null;
        return p.getString(key, null);
    }

    public boolean remove(String key) {
        SharedPreferences p = prefs();
        if (p == null) return false;
        return p.edit().remove(key).commit();
    }

    public boolean contains(String key) {
        SharedPreferences p = prefs();
        return p != null && p.contains(key);
    }
}

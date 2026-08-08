package com.foxdebug.sftp;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyStore;
import java.util.UUID;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONException;
import org.json.JSONObject;

final class SftpSecurityStore {

  static final String PROFILE_PREFIX = "profile-";
  private static final String KEYSTORE = "AndroidKeyStore";
  private static final String KEY_ALIAS = "acode.sftp.profile.key.v1";
  private static final String PROFILE_PREFS = "acode_sftp_profiles_v1";
  private static final String HOST_PREFS = "acode_ssh_known_hosts_v1";
  private static final String CIPHER = "AES/GCM/NoPadding";
  private static final int GCM_TAG_BITS = 128;

  private final SharedPreferences profiles;
  private final SharedPreferences knownHosts;

  SftpSecurityStore(Context context) {
    profiles = context.getSharedPreferences(PROFILE_PREFS, Context.MODE_PRIVATE);
    knownHosts = context.getSharedPreferences(HOST_PREFS, Context.MODE_PRIVATE);
  }

  static boolean isProfileID(String value) {
    return value != null && value.startsWith(PROFILE_PREFIX);
  }

  synchronized String saveProfile(String requestedID, JSONObject profile)
    throws GeneralSecurityException, JSONException {
    String profileID = isProfileID(requestedID)
      ? requestedID
      : PROFILE_PREFIX + UUID.randomUUID();
    if (
      !profiles
        .edit()
        .putString(profileID, encrypt(profileID, profile.toString()))
        .commit()
    ) {
      throw new GeneralSecurityException("Could not persist SFTP profile");
    }
    return profileID;
  }

  synchronized JSONObject getProfile(String profileID)
    throws GeneralSecurityException, JSONException {
    if (!isProfileID(profileID)) throw new GeneralSecurityException(
      "Invalid SFTP profile ID"
    );
    String encrypted = profiles.getString(profileID, null);
    if (encrypted == null) throw new GeneralSecurityException(
      "SFTP profile was not found"
    );
    return new JSONObject(decrypt(profileID, encrypted));
  }

  synchronized void deleteProfile(String profileID) {
    if (isProfileID(profileID)) profiles.edit().remove(profileID).commit();
  }

  synchronized JSONObject getKnownHost(String host) throws JSONException {
    String value = knownHosts.getString(host, null);
    return value == null ? null : new JSONObject(value);
  }

  synchronized void trustHost(
    String host,
    String algorithm,
    String fingerprint,
    String publicKey
  ) throws JSONException {
    JSONObject record = new JSONObject();
    record.put("algorithm", algorithm);
    record.put("fingerprint", fingerprint);
    record.put("publicKey", publicKey);
    if (!knownHosts.edit().putString(host, record.toString()).commit()) {
      throw new JSONException("Could not persist trusted SSH host");
    }
  }

  private String encrypt(String profileID, String plaintext)
    throws GeneralSecurityException, JSONException {
    Cipher cipher = Cipher.getInstance(CIPHER);
    cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey());
    cipher.updateAAD(profileID.getBytes(StandardCharsets.UTF_8));
    byte[] encrypted = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));
    byte[] iv = cipher.getIV();
    ByteBuffer payload = ByteBuffer.allocate(1 + iv.length + encrypted.length);
    payload.put((byte) iv.length);
    payload.put(iv);
    payload.put(encrypted);
    return Base64.encodeToString(payload.array(), Base64.NO_WRAP);
  }

  private String decrypt(String profileID, String encoded)
    throws GeneralSecurityException {
    byte[] payload = Base64.decode(encoded, Base64.NO_WRAP);
    ByteBuffer buffer = ByteBuffer.wrap(payload);
    int ivLength = buffer.get() & 0xff;
    if (ivLength < 12 || ivLength > 16 || buffer.remaining() <= ivLength) {
      throw new GeneralSecurityException("Invalid encrypted SFTP profile");
    }
    byte[] iv = new byte[ivLength];
    byte[] encrypted = new byte[buffer.remaining() - ivLength];
    buffer.get(iv);
    buffer.get(encrypted);

    Cipher cipher = Cipher.getInstance(CIPHER);
    cipher.init(
      Cipher.DECRYPT_MODE,
      getOrCreateKey(),
      new GCMParameterSpec(GCM_TAG_BITS, iv)
    );
    cipher.updateAAD(profileID.getBytes(StandardCharsets.UTF_8));
    return new String(cipher.doFinal(encrypted), StandardCharsets.UTF_8);
  }

  private SecretKey getOrCreateKey() throws GeneralSecurityException {
    KeyStore keyStore = KeyStore.getInstance(KEYSTORE);
    try {
      keyStore.load(null);
    } catch (java.io.IOException e) {
      throw new GeneralSecurityException("Could not load Android Keystore", e);
    }

    if (keyStore.containsAlias(KEY_ALIAS)) {
      return (SecretKey) keyStore.getKey(KEY_ALIAS, null);
    }

    KeyGenerator generator = KeyGenerator.getInstance(
      KeyProperties.KEY_ALGORITHM_AES,
      KEYSTORE
    );
    generator.init(
      new KeyGenParameterSpec.Builder(
        KEY_ALIAS,
        KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
      )
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .setRandomizedEncryptionRequired(true)
        .build()
    );
    return generator.generateKey();
  }
}

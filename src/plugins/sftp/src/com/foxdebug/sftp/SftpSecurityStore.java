package com.foxdebug.sftp;

import android.content.Context;
import com.foxdebug.acode.rk.auth.EncryptedPreferenceManager;
import java.security.GeneralSecurityException;
import java.util.UUID;
import org.json.JSONException;
import org.json.JSONObject;

final class SftpSecurityStore {

  static final String PROFILE_PREFIX = "profile-";
  private static final String PROFILE_PREFS = "acode_sftp_profiles_v1";
  private static final String HOST_PREFS = "acode_ssh_known_hosts_v1";

  private final EncryptedPreferenceManager profiles;
  private final EncryptedPreferenceManager knownHosts;

  SftpSecurityStore(Context context) {
    // SSH credentials and trusted-host records must never fall back to plaintext.
    profiles = new EncryptedPreferenceManager(context, PROFILE_PREFS, false);
    knownHosts = new EncryptedPreferenceManager(context, HOST_PREFS, false);
  }

  static boolean isProfileID(String value) {
    return value != null && value.startsWith(PROFILE_PREFIX);
  }

  synchronized String saveProfile(String requestedID, JSONObject profile)
    throws GeneralSecurityException, JSONException {
    String profileID = isProfileID(requestedID)
      ? requestedID
      : PROFILE_PREFIX + UUID.randomUUID();
    if (!profiles.setStringSync(profileID, profile.toString())) {
      throw new GeneralSecurityException("Could not persist SFTP profile");
    }
    return profileID;
  }

  synchronized JSONObject getProfile(String profileID)
    throws GeneralSecurityException, JSONException {
    if (!isProfileID(profileID)) throw new GeneralSecurityException(
      "Invalid SFTP profile ID"
    );
    String storedProfile = profiles.getString(profileID, null);
    if (storedProfile == null) throw new GeneralSecurityException(
      "SFTP profile was not found"
    );
    return new JSONObject(storedProfile);
  }

  synchronized void deleteProfile(String profileID) {
    if (isProfileID(profileID)) profiles.removeSync(profileID);
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
    if (!knownHosts.setStringSync(host, record.toString())) {
      throw new JSONException("Could not persist trusted SSH host");
    }
  }
}

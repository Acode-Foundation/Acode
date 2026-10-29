package com.foxdebug.webview;

import android.util.Log;
import android.webkit.CookieManager;
import android.webkit.WebStorage;
import android.webkit.WebView;
import androidx.webkit.Profile;
import androidx.webkit.ProfileStore;
import androidx.webkit.WebStorageCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Incognito / profile isolation built on AndroidX WebKit's multi-profile API.
 *
 * <p>WebView profiles provide a genuinely separate cookie jar and web-storage
 * area, which is what "incognito" needs. Support depends on the installed
 * WebView provider ({@link WebViewFeature#MULTI_PROFILE}); when it is missing
 * {@link #acquire} returns {@code null} and the instance falls back to the
 * best-effort behaviour documented on {@code WebViewInstance}.
 *
 * <p>A profile is acquired when the instance is created (so its isolation state
 * is known before the lazily created fullscreen WebView exists) and bound to
 * the WebView once it is constructed. Profiles are reference counted so several
 * instances can share one. Data is cleared when the last instance goes away,
 * and auto-generated incognito profiles are also deleted.
 */
final class ProfileManager {

  private static final String TAG = "AcodeWebView";
  private static final String EPHEMERAL_PREFIX = "acode_incognito_";
  private static final int MAX_NAME_LENGTH = 64;

  /**
   * Profile names are passed to the WebView provider verbatim, so they must be
   * canonical. Anything else is rejected instead of being rewritten, which
   * would let two different requested names collide onto one shared profile.
   */
  private static final Pattern VALID_NAME = Pattern.compile("[A-Za-z0-9_-]{1," + MAX_NAME_LENGTH + "}");

  private static final Map<String, Integer> refCounts = new HashMap<>();

  private ProfileManager() {}

  static boolean isSupported() {
    try {
      return WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE);
    } catch (Throwable t) {
      return false;
    }
  }

  static boolean canDeleteBrowsingData() {
    try {
      return WebViewFeature.isFeatureSupported(WebViewFeature.DELETE_BROWSING_DATA);
    } catch (Throwable t) {
      return false;
    }
  }

  /** True when {@code name} can be used verbatim as a WebView profile name. */
  static boolean isValidName(String name) {
    return name != null && VALID_NAME.matcher(name).matches();
  }

  /** True for the reserved namespace used by auto-generated incognito profiles. */
  static boolean isReservedName(String name) {
    return name != null && name.startsWith(EPHEMERAL_PREFIX);
  }

  /**
   * Validates a caller-supplied profile name. Rejecting (rather than rewriting)
   * guarantees distinct requested names never select the same profile.
   */
  static void requireValidUserName(String name) {
    if (!isValidName(name)) {
      throw new IllegalArgumentException(
        "Unsupported profileName: \"" + name
          + "\". Use 1-" + MAX_NAME_LENGTH + " characters from A-Z, a-z, 0-9, \"_\" or \"-\"."
      );
    }
    if (isReservedName(name)) {
      throw new IllegalArgumentException(
        "Unsupported profileName: \"" + name + "\" uses the reserved \""
          + EPHEMERAL_PREFIX + "\" prefix."
      );
    }
  }

  /** Name for an auto-generated, ephemeral incognito profile. */
  static String ephemeralName(String id) {
    StringBuilder builder = new StringBuilder(EPHEMERAL_PREFIX);
    String source = id != null ? id : "";
    for (int i = 0; i < source.length() && builder.length() < MAX_NAME_LENGTH; i++) {
      char c = source.charAt(i);
      if (Character.isLetterOrDigit(c) || c == '_' || c == '-') {
        builder.append(c);
      }
    }
    return builder.toString();
  }

  /**
   * Creates (or joins) the named profile and takes a reference. Runs on the UI
   * thread, before the WebView exists. Returns null when isolation is not
   * available; callers then use the documented fallback.
   */
  static Profile acquire(String profileName) {
    if (profileName == null || !isSupported()) return null;
    try {
      ProfileStore store = ProfileStore.getInstance();
      Profile profile = store.getOrCreateProfile(profileName);
      if (profile == null) return null;

      CookieManager cookies = profile.getCookieManager();
      if (cookies != null) {
        cookies.setAcceptCookie(true);
      }

      refCounts.merge(profileName, 1, Integer::sum);
      return profile;
    } catch (Throwable t) {
      // Any provider-side failure degrades to the non-isolated fallback rather
      // than failing instance creation.
      Log.w(TAG, "Profile isolation unavailable for \"" + profileName + "\"", t);
      return null;
    }
  }

  /**
   * Binds an acquired profile to a freshly constructed WebView. Must run on the
   * UI thread and before the WebView loads any content.
   */
  static boolean bind(WebView view, Profile profile) {
    if (view == null || profile == null) return false;
    try {
      WebViewCompat.setProfile(view, profile.getName());
      return true;
    } catch (Throwable t) {
      Log.w(TAG, "Could not bind profile \"" + profile.getName() + "\"", t);
      return false;
    }
  }

  /**
   * Releases one reference to a profile. When the last reference is gone the
   * profile's browsing data is cleared and, if it was auto-generated for
   * incognito, the profile itself is deleted.
   */
  static void release(String profileName, boolean ephemeral, boolean clearData) {
    if (profileName == null) return;

    Integer count = refCounts.get(profileName);
    if (count == null) return;
    if (count > 1) {
      refCounts.put(profileName, count - 1);
      return;
    }
    refCounts.remove(profileName);

    if (!clearData && !ephemeral) return;

    try {
      ProfileStore store = ProfileStore.getInstance();
      Profile profile = store.getProfile(profileName);
      if (profile == null) {
        if (ephemeral) deleteQuietly(profileName);
        return;
      }
      clearProfile(profile, () -> {
        if (ephemeral) deleteQuietly(profileName);
      });
    } catch (Throwable t) {
      Log.w(TAG, "Could not release profile \"" + profileName + "\"", t);
    }
  }

  /**
   * Deletes auto-generated incognito profiles left behind by a previous
   * process (for example when the app was killed before cleanup ran).
   */
  static void cleanupEphemeralProfiles() {
    if (!isSupported()) return;
    try {
      ProfileStore store = ProfileStore.getInstance();
      List<String> names = new ArrayList<>(store.getAllProfileNames());
      for (String name : names) {
        if (name == null || !name.startsWith(EPHEMERAL_PREFIX)) continue;
        Profile profile = store.getProfile(name);
        if (profile == null) {
          deleteQuietly(name);
        } else {
          clearProfile(profile, () -> deleteQuietly(name));
        }
      }
    } catch (Throwable t) {
      Log.w(TAG, "Could not clean up ephemeral profiles", t);
    }
  }

  private static void clearProfile(Profile profile, Runnable onDone) {
    try {
      CookieManager cookies = profile.getCookieManager();
      if (cookies != null) {
        cookies.removeAllCookies(null);
      }
    } catch (Throwable t) {
      Log.w(TAG, "Could not clear profile cookies", t);
    }

    WebStorage storage = null;
    try {
      storage = profile.getWebStorage();
    } catch (Throwable t) {
      Log.w(TAG, "Could not access profile web storage", t);
    }

    if (storage == null) {
      if (onDone != null) onDone.run();
      return;
    }

    if (canDeleteBrowsingData()) {
      try {
        WebStorageCompat.deleteBrowsingData(storage, onDone);
        return;
      } catch (Throwable t) {
        Log.w(TAG, "deleteBrowsingData failed; falling back to deleteAllData", t);
      }
    }

    try {
      storage.deleteAllData();
    } catch (Throwable t) {
      Log.w(TAG, "Could not clear profile web storage", t);
    }
    if (onDone != null) onDone.run();
  }

  private static void deleteQuietly(String profileName) {
    try {
      ProfileStore.getInstance().deleteProfile(profileName);
    } catch (Throwable t) {
      Log.w(TAG, "Could not delete profile \"" + profileName + "\"", t);
    }
  }
}

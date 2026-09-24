package com.foxdebug.webview;

import android.content.Context;
import android.graphics.Color;
import android.util.Log;
import android.webkit.CookieManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import org.json.JSONObject;

/**
 * Configuration for a {@link WebViewInstance}.
 *
 * <p>Behavioural options (mode, title, visibility, isolation) are kept as typed
 * fields. Web settings are kept in a normalized {@link JSONObject} so they can
 * be merged on partial updates and handed back to the caller verbatim.
 *
 * <p>Only a known allow-list of settings is ever read, so a caller cannot
 * switch on file/content access or otherwise break the navigation sandbox.
 * Those stay pinned to the isolation-safe defaults in {@link #applyPartial}.
 */
final class WebViewOptions {

  private static final String TAG = "WebViewOptions";

  static final String DEFAULT_MODE = "hidden";
  static final String DEFAULT_USER_AGENT_MODE = "default";
  static final String DEFAULT_CACHE_MODE = "default";
  static final String DEFAULT_MIXED_CONTENT_MODE = "never-allow";
  static final String DEFAULT_ALGORITHMIC_DARKENING = "auto";

  /** Settings that may be changed at runtime through updateSettings(). */
  private static final Set<String> SETTING_KEYS = new HashSet<>(Arrays.asList(
    "userAgent",
    "userAgentMode",
    "javaScript",
    "domStorage",
    "databaseStorage",
    "cacheMode",
    "mediaPlaybackRequiresUserGesture",
    "loadImages",
    "mixedContentMode",
    "textZoom",
    "initialScale",
    "useWideViewPort",
    "loadWithOverviewMode",
    "supportZoom",
    "builtInZoomControls",
    "displayZoomControls",
    "geolocation",
    "safeBrowsing",
    "algorithmicDarkening",
    "acceptThirdPartyCookies",
    "backgroundColor"
  ));

  final String mode;
  final String title;
  final boolean visible;
  final boolean incognito;
  final String profileName;
  final boolean allowNavigation;
  final boolean allowDownloads;

  /** Normalized, complete web-settings snapshot. */
  private final JSONObject values;

  private WebViewOptions(
    String mode,
    String title,
    boolean visible,
    boolean incognito,
    String profileName,
    boolean allowNavigation,
    boolean allowDownloads,
    JSONObject values
  ) {
    this.mode = mode;
    this.title = title;
    this.visible = visible;
    this.incognito = incognito;
    this.profileName = profileName;
    this.allowNavigation = allowNavigation;
    this.allowDownloads = allowDownloads;
    this.values = values;
  }

  static WebViewOptions fromJson(JSONObject input) {
    JSONObject source = input != null ? input : new JSONObject();

    String mode = source.optString("mode", DEFAULT_MODE);
    if (!"fullscreen".equals(mode) && !"hidden".equals(mode)) {
      throw new IllegalArgumentException(
        "Unsupported WebView mode: \"" + mode + "\". Use \"fullscreen\" or \"hidden\"."
      );
    }

    String userAgentMode = source.optString("userAgentMode", DEFAULT_USER_AGENT_MODE);
    if (!"default".equals(userAgentMode)
      && !"mobile".equals(userAgentMode)
      && !"desktop".equals(userAgentMode)) {
      throw new IllegalArgumentException(
        "Unsupported userAgentMode: \"" + userAgentMode
          + "\". Use \"default\", \"mobile\" or \"desktop\"."
      );
    }

    boolean incognito = source.optBoolean("incognito", false);

    // Profile names are used verbatim; reject non-canonical input instead of
    // rewriting it so two different names can never select the same profile.
    String profileName = optString(source, "profileName");
    if (profileName != null) {
      ProfileManager.requireValidUserName(profileName);
    }

    JSONObject values = defaults(incognito);
    merge(values, source);
    clampSettings(values);
    validateEnums(values);

    return new WebViewOptions(
      mode,
      source.optString("title", ""),
      source.optBoolean("visible", true),
      incognito,
      profileName,
      source.optBoolean("allowNavigation", true),
      source.optBoolean("allowDownloads", false),
      values
    );
  }

  /** Full settings snapshot including behavioural keys, for the JS layer. */
  JSONObject toJson() {
    JSONObject out = copy(values);
    putQuietly(out, "mode", mode);
    putQuietly(out, "title", title);
    putQuietly(out, "visible", visible);
    putQuietly(out, "incognito", incognito);
    if (profileName != null) {
      putQuietly(out, "profileName", profileName);
    }
    putQuietly(out, "allowNavigation", allowNavigation);
    putQuietly(out, "allowDownloads", allowDownloads);
    return out;
  }

  private static JSONObject defaults(boolean incognito) {
    JSONObject values = new JSONObject();
    putQuietly(values, "userAgent", JSONObject.NULL);
    putQuietly(values, "userAgentMode", DEFAULT_USER_AGENT_MODE);
    putQuietly(values, "javaScript", true);
    putQuietly(values, "domStorage", true);
    putQuietly(values, "databaseStorage", false);
    putQuietly(values, "cacheMode", incognito ? "no-cache" : DEFAULT_CACHE_MODE);
    putQuietly(values, "mediaPlaybackRequiresUserGesture", true);
    putQuietly(values, "loadImages", true);
    putQuietly(values, "mixedContentMode", DEFAULT_MIXED_CONTENT_MODE);
    putQuietly(values, "textZoom", 100);
    putQuietly(values, "initialScale", 0);
    putQuietly(values, "useWideViewPort", true);
    putQuietly(values, "loadWithOverviewMode", true);
    putQuietly(values, "supportZoom", true);
    putQuietly(values, "builtInZoomControls", false);
    putQuietly(values, "displayZoomControls", false);
    putQuietly(values, "geolocation", false);
    putQuietly(values, "safeBrowsing", true);
    putQuietly(values, "algorithmicDarkening", DEFAULT_ALGORITHMIC_DARKENING);
    putQuietly(values, "acceptThirdPartyCookies", incognito ? false : JSONObject.NULL);
    putQuietly(values, "backgroundColor", JSONObject.NULL);
    return values;
  }

  private static void validateEnums(JSONObject values) {
    String cacheMode = values.optString("cacheMode", DEFAULT_CACHE_MODE);
    if (!"default".equals(cacheMode)
      && !"no-cache".equals(cacheMode)
      && !"cache-only".equals(cacheMode)
      && !"cache-else-network".equals(cacheMode)) {
      throw new IllegalArgumentException(
        "Unsupported cacheMode: \"" + cacheMode
          + "\". Use \"default\", \"no-cache\", \"cache-only\" or \"cache-else-network\"."
      );
    }

    String mixed = values.optString("mixedContentMode", DEFAULT_MIXED_CONTENT_MODE);
    if (!"never-allow".equals(mixed)
      && !"compatibility".equals(mixed)
      && !"always-allow".equals(mixed)) {
      throw new IllegalArgumentException(
        "Unsupported mixedContentMode: \"" + mixed
          + "\". Use \"never-allow\", \"compatibility\" or \"always-allow\"."
      );
    }

    String darkening = values.optString("algorithmicDarkening", DEFAULT_ALGORITHMIC_DARKENING);
    if (!"auto".equals(darkening) && !"on".equals(darkening) && !"off".equals(darkening)) {
      throw new IllegalArgumentException(
        "Unsupported algorithmicDarkening: \"" + darkening
          + "\". Use \"auto\", \"on\" or \"off\"."
      );
    }

    String userAgentMode = values.optString("userAgentMode", DEFAULT_USER_AGENT_MODE);
    if (!"default".equals(userAgentMode)
      && !"mobile".equals(userAgentMode)
      && !"desktop".equals(userAgentMode)) {
      throw new IllegalArgumentException(
        "Unsupported userAgentMode: \"" + userAgentMode
          + "\". Use \"default\", \"mobile\" or \"desktop\"."
      );
    }
  }

  private static void clampSettings(JSONObject values) {
    if (values.has("textZoom")) {
      putQuietly(values, "textZoom", clamp(values.optInt("textZoom", 100), 25, 500));
    }
    if (values.has("initialScale")) {
      putQuietly(values, "initialScale", clamp(values.optInt("initialScale", 0), 0, 1000));
    }
  }

  /** Applies every setting in this snapshot to a freshly created WebView. */
  void applyTo(WebView view, Context context) {
    applyPartial(view, context, values);
  }

  /**
   * Merges (and applies) a partial settings object. Unknown keys are ignored,
   * isolation-critical settings are always forced, and the resulting normalized
   * settings are returned.
   */
  JSONObject update(WebView view, Context context, JSONObject partial) {
    JSONObject applied = new JSONObject();
    if (partial != null) {
      for (String key : SETTING_KEYS) {
        if (partial.has(key)) {
          putQuietly(applied, key, partial.opt(key));
        }
      }
    }

    validateEnums(mergeIntoSnapshot(applied));
    clampSettings(applied);
    // A fullscreen instance may not have created its WebView yet; merge now so
    // the settings apply when createWebView() runs.
    if (view != null) {
      applyPartial(view, context, applied, true);
    }
    merge(values, applied);
    if (applied.has("userAgentMode") && !applied.has("userAgent")) {
      // The mode now decides the UA; drop any stale explicit override.
      putQuietly(values, "userAgent", JSONObject.NULL);
    }
    return copy(values);
  }

  private JSONObject mergeIntoSnapshot(JSONObject partial) {
    JSONObject merged = copy(values);
    merge(merged, partial);
    return merged;
  }

  /** Current normalized settings snapshot. */
  JSONObject settings() {
    return copy(values);
  }

  /**
   * Single source of truth for translating options into {@link WebSettings}
   * calls. Only keys present in {@code source} are touched, so the same method
   * serves both initial creation and runtime updates.
   */
  static void applyPartial(WebView view, Context context, JSONObject source) {
    applyPartial(view, context, source, false);
  }

  private static void applyPartial(
    WebView view,
    Context context,
    JSONObject source,
    boolean runtimeUpdate
  ) {
    WebSettings settings = view.getSettings();

    // Isolation is not configurable: hosted content must never be able to
    // reach app/device data, and navigation below only permits http(s).
    settings.setAllowFileAccess(false);
    settings.setAllowContentAccess(false);
    setFileUrlAccessFlags(settings);
    settings.setSaveFormData(false);
    settings.setSupportMultipleWindows(false);
    settings.setJavaScriptCanOpenWindowsAutomatically(false);

    if (source.has("javaScript")) {
      settings.setJavaScriptEnabled(source.optBoolean("javaScript", true));
    }
    if (source.has("domStorage")) {
      settings.setDomStorageEnabled(source.optBoolean("domStorage", true));
    }
    if (source.has("databaseStorage")) {
      settings.setDatabaseEnabled(source.optBoolean("databaseStorage", false));
    }
    if (source.has("cacheMode")) {
      settings.setCacheMode(cacheMode(source.optString("cacheMode", DEFAULT_CACHE_MODE)));
    }
    if (source.has("mediaPlaybackRequiresUserGesture")) {
      settings.setMediaPlaybackRequiresUserGesture(
        source.optBoolean("mediaPlaybackRequiresUserGesture", true)
      );
    }
    if (source.has("loadImages")) {
      boolean loadImages = source.optBoolean("loadImages", true);
      settings.setLoadsImagesAutomatically(loadImages);
      settings.setBlockNetworkImage(!loadImages);
    }
    if (source.has("mixedContentMode")) {
      settings.setMixedContentMode(
        mixedContentMode(source.optString("mixedContentMode", DEFAULT_MIXED_CONTENT_MODE))
      );
    }
    if (source.has("textZoom")) {
      settings.setTextZoom(clamp(source.optInt("textZoom", 100), 25, 500));
    }
    if (source.has("useWideViewPort")) {
      settings.setUseWideViewPort(source.optBoolean("useWideViewPort", true));
    }
    if (source.has("loadWithOverviewMode")) {
      settings.setLoadWithOverviewMode(source.optBoolean("loadWithOverviewMode", true));
    }
    if (source.has("supportZoom")) {
      settings.setSupportZoom(source.optBoolean("supportZoom", true));
    }
    if (source.has("builtInZoomControls")) {
      settings.setBuiltInZoomControls(source.optBoolean("builtInZoomControls", false));
    }
    if (source.has("displayZoomControls")) {
      settings.setDisplayZoomControls(source.optBoolean("displayZoomControls", false));
    }
    if (source.has("initialScale")) {
      view.setInitialScale(clamp(source.optInt("initialScale", 0), 0, 1000));
    }
    if (source.has("geolocation")) {
      settings.setGeolocationEnabled(source.optBoolean("geolocation", false));
    }
    if (source.has("acceptThirdPartyCookies")) {
      if (!source.isNull("acceptThirdPartyCookies")) {
        CookieManager.getInstance().setAcceptThirdPartyCookies(
          view,
          source.optBoolean("acceptThirdPartyCookies", false)
        );
      }
    }
    if (source.has("safeBrowsing")) {
      applyFeatureSafely("safeBrowsing", () -> {
        if (WebViewFeature.isFeatureSupported(WebViewFeature.SAFE_BROWSING_ENABLE)) {
          WebSettingsCompat.setSafeBrowsingEnabled(
            settings,
            source.optBoolean("safeBrowsing", true)
          );
        }
      });
    }
    if (source.has("algorithmicDarkening")) {
      String darkening = source.optString("algorithmicDarkening", DEFAULT_ALGORITHMIC_DARKENING);
      if (!"auto".equals(darkening)) {
        applyFeatureSafely("algorithmicDarkening", () -> {
          if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
            WebSettingsCompat.setAlgorithmicDarkeningAllowed(settings, "on".equals(darkening));
          }
        });
      }
    }
    if (source.has("backgroundColor")) {
      applyBackgroundColor(view, source);
    }
    // User agent is applied last so callers can override preset handling with
    // an explicit string in the same batch.
    if (source.has("userAgent") || source.has("userAgentMode")) {
      resolveUserAgent(context, settings, source);
    }

    if (runtimeUpdate) {
      Log.d(TAG, "Applied runtime settings update");
    }
  }

  private static void applyBackgroundColor(WebView view, JSONObject source) {
    if (source.isNull("backgroundColor")) return;
    String value = source.optString("backgroundColor", "");
    if (value == null || value.isEmpty()) return;
    try {
      view.setBackgroundColor(Color.parseColor(value));
    } catch (IllegalArgumentException e) {
      Log.w(TAG, "Ignoring invalid backgroundColor: " + value);
    }
  }

  /**
   * Resolves the user agent from either an explicit string or a preset mode.
   * "desktop" is the platform default with the Mobile token removed; "mobile"
   * restores the platform default; "default" clears any override.
   */
  static String resolveUserAgent(Context context, WebSettings settings, JSONObject source) {
    String explicit = optString(source, "userAgent");
    String mode = source.optString("userAgentMode", DEFAULT_USER_AGENT_MODE);
    String result;

    if (explicit != null && !explicit.trim().isEmpty()) {
      result = explicit.trim();
    } else if ("desktop".equals(mode)) {
      result = desktopUserAgent(context);
    } else if ("mobile".equals(mode)) {
      result = WebSettings.getDefaultUserAgent(context);
    } else {
      result = null;
    }

    settings.setUserAgentString(result);
    String applied = settings.getUserAgentString();
    return applied != null ? applied : "";
  }

  private static String desktopUserAgent(Context context) {
    String ua = WebSettings.getDefaultUserAgent(context);
    if (ua == null) return null;
    return ua.replace(" Mobile", "").replace("; wv", "");
  }

  static int cacheMode(String value) {
    switch (value == null ? DEFAULT_CACHE_MODE : value) {
      case "no-cache":
        return WebSettings.LOAD_NO_CACHE;
      case "cache-only":
        return WebSettings.LOAD_CACHE_ONLY;
      case "cache-else-network":
        return WebSettings.LOAD_CACHE_ELSE_NETWORK;
      default:
        return WebSettings.LOAD_DEFAULT;
    }
  }

  static int mixedContentMode(String value) {
    switch (value == null ? DEFAULT_MIXED_CONTENT_MODE : value) {
      case "always-allow":
        return WebSettings.MIXED_CONTENT_ALWAYS_ALLOW;
      case "compatibility":
        return WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE;
      default:
        return WebSettings.MIXED_CONTENT_NEVER_ALLOW;
    }
  }

  interface ThrowingRunnable {
    void run() throws Exception;
  }

  private static void applyFeatureSafely(String feature, ThrowingRunnable action) {
    try {
      action.run();
    } catch (Exception e) {
      // Feature probes can throw on some WebView providers; a missing optional
      // feature must never fail instance creation.
      Log.w(TAG, "Could not apply " + feature + ": " + e.getMessage());
    }
  }

  @SuppressWarnings("deprecation")
  private static void setFileUrlAccessFlags(WebSettings settings) {
    settings.setAllowFileAccessFromFileURLs(false);
    settings.setAllowUniversalAccessFromFileURLs(false);
  }

  private static int clamp(int value, int min, int max) {
    return Math.max(min, Math.min(max, value));
  }

  private static String optString(JSONObject object, String key) {
    if (object == null || !object.has(key) || object.isNull(key)) return null;
    return object.optString(key, null);
  }

  private static void putQuietly(JSONObject object, String key, Object value) {
    try {
      object.put(key, value);
    } catch (Exception e) {
      Log.w(TAG, "Could not set option " + key, e);
    }
  }

  private static void merge(JSONObject target, JSONObject source) {
    if (source == null) return;
    for (String key : SETTING_KEYS) {
      if (source.has(key)) {
        putQuietly(target, key, source.opt(key));
      }
    }
  }

  private static JSONObject copy(JSONObject source) {
    JSONObject out = new JSONObject();
    if (source == null) return out;
    // Android's org.json exposes keys() (Iterator), not keySet().
    java.util.Iterator<String> keys = source.keys();
    while (keys.hasNext()) {
      String key = keys.next();
      putQuietly(out, key, source.opt(key));
    }
    return out;
  }
}

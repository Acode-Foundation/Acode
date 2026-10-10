package com.foxdebug.webview;

import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Environment;
import android.util.Log;
import android.webkit.CookieManager;
import android.widget.Toast;
import androidx.webkit.WebViewFeature;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.UUID;
import org.apache.cordova.CallbackContext;
import org.apache.cordova.CordovaPlugin;
import org.apache.cordova.PluginResult;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Cordova entry point for the Acode WebView API.
 *
 * <p>Owns the instance registry, routes each JS call to the matching
 * {@link WebViewInstance}, and forwards page/lifecycle events back over the
 * single long-lived "setMessageCallback" channel.
 */
public class WebViewPlugin extends CordovaPlugin {

  private static final String TAG = "AcodeWebView";
  private static final String PLUGIN_VERSION = "2.0.0";
  private static WebViewPlugin instance;

  private final HashMap<String, WebViewInstance> instances = new HashMap<>();
  private CallbackContext messageCallback;

  @Override
  protected void pluginInitialize() {
    instance = this;
    // Remove incognito profiles left behind if the process was killed before
    // their instance could be destroyed.
    ProfileManager.cleanupEphemeralProfiles();
  }

  public static WebViewPlugin getInstance() {
    return instance;
  }

  @Override
  public boolean execute(String action, JSONArray args, CallbackContext callbackContext) {
    try {
      switch (action) {
        case "setMessageCallback":
          setMessageCallback(callbackContext);
          return true;
        case "capabilities":
          callbackContext.success(capabilities());
          return true;
        case "create":
          create(args.optJSONObject(0), callbackContext);
          return true;
        case "loadURL":
          loadURL(args.getString(0), optionalString(args, 1), args.optJSONObject(2), callbackContext);
          return true;
        case "loadHTML":
          loadHTML(args.getString(0), args.getString(1), args.optJSONObject(2), callbackContext);
          return true;
        case "evaluate":
          evaluate(args.getString(0), args.getString(1), callbackContext);
          return true;
        case "postMessage":
          postMessage(args.getString(0), args.getString(1), callbackContext);
          return true;
        case "show":
          show(args.getString(0), callbackContext);
          return true;
        case "hide":
          hide(args.getString(0), callbackContext);
          return true;
        case "reload":
          reload(args.getString(0), callbackContext);
          return true;
        case "stopLoading":
          stopLoading(args.getString(0), callbackContext);
          return true;
        case "goBack":
          goBack(args.getString(0), callbackContext);
          return true;
        case "goForward":
          goForward(args.getString(0), callbackContext);
          return true;
        case "canGoBack":
          canGoBack(args.getString(0), callbackContext);
          return true;
        case "canGoForward":
          canGoForward(args.getString(0), callbackContext);
          return true;
        case "clearCache":
          clearCache(args.getString(0), args.optBoolean(1, true), callbackContext);
          return true;
        case "clearHistory":
          clearHistory(args.getString(0), callbackContext);
          return true;
        case "clearFormData":
          clearFormData(args.getString(0), callbackContext);
          return true;
        case "setUserAgent":
          setUserAgent(
            args.getString(0),
            optionalString(args, 1),
            optionalString(args, 2),
            callbackContext
          );
          return true;
        case "getUserAgent":
          getUserAgent(args.getString(0), callbackContext);
          return true;
        case "updateSettings":
          updateSettings(args.getString(0), args.optJSONObject(1), callbackContext);
          return true;
        case "getSettings":
          getSettings(args.getString(0), callbackContext);
          return true;
        case "getInfo":
          getInfo(args.getString(0), callbackContext);
          return true;
        case "destroy":
          destroy(args.getString(0), callbackContext);
          return true;
        default:
          callbackContext.error("Unknown action: " + action);
          return true;
      }
    } catch (Exception e) {
      Log.e(TAG, "Error handling action: " + action, e);
      callbackContext.error(e.getMessage());
    }
    return true;
  }

  private void setMessageCallback(CallbackContext callbackContext) {
    this.messageCallback = callbackContext;
    PluginResult keepResult = new PluginResult(PluginResult.Status.NO_RESULT);
    keepResult.setKeepCallback(true);
    callbackContext.sendPluginResult(keepResult);
  }

  /**
   * Reads an optional string argument, mapping JSON null/missing to Java null.
   * Android's {@code JSONArray.optString(index, fallback)} returns the literal
   * string "null" for a JSON null value, which would otherwise leak into
   * options such as the user agent.
   */
  private static String optionalString(JSONArray args, int index) {
    if (args == null || args.isNull(index)) return null;
    return args.optString(index, null);
  }

  private String generateId() {
    return "wv_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
  }

  private void create(final JSONObject rawOptions, final CallbackContext callbackContext) {
    final WebViewOptions options;
    try {
      options = WebViewOptions.fromJson(rawOptions);
    } catch (IllegalArgumentException e) {
      callbackContext.error(e.getMessage());
      return;
    }

    final String id = generateId();

    cordova.getActivity().runOnUiThread(() -> {
      WebViewInstance instance = new WebViewInstance(id, options, WebViewPlugin.this);
      instances.put(id, instance);

      try {
        if (instance.isFullscreen()) {
          // The WebView is created lazily by WebViewActivity. When the caller
          // asked for an initially hidden instance, the launch is deferred
          // until show() is called.
          if (options.visible) {
            showFullscreenActivity(id);
          }
        } else {
          // "hidden" mode: a headless WebView that is never displayed.
          instance.createWebView(cordova.getActivity());
        }

        JSONObject result = new JSONObject();
        result.put("id", id);
        result.put("isolated", instance.isIsolated());
        result.put("ready", instance.isReady());
        if (instance.getProfileName() != null) {
          result.put("profileName", instance.getProfileName());
        }
        result.put("options", options.toJson());
        result.put("capabilities", capabilities());
        callbackContext.success(result);
      } catch (Exception e) {
        instances.remove(id);
        try {
          instance.destroy();
        } catch (Exception ignored) {}
        Log.e(TAG, "Create error: " + e.getMessage(), e);
        callbackContext.error(e.getMessage());
      }
    });
  }

  /**
   * Shows a fullscreen WebView: launches its hosting activity, or brings the
   * existing one back to the front if it is still alive (e.g. after hide()
   * backgrounded it), preserving the WebView's page state.
   */
  void showFullscreenActivity(String id) {
    Intent intent = new Intent(cordova.getActivity(), WebViewActivity.class);
    intent.putExtra("webviewId", id);
    WebViewInstance target = getInstance(id);
    WebViewActivity hosting = target != null ? target.getHostingActivity() : null;
    if (hosting != null && !hosting.isFinishing() && !hosting.isDestroyed()) {
      intent.addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
    }
    cordova.getActivity().startActivity(intent);
  }

  public WebViewInstance getInstance(String id) {
    return instances.get(id);
  }

  public void removeInstance(String id) {
    instances.remove(id);
  }

  /** Context used for options that need a Context even before the WebView exists. */
  public Context getContext() {
    return cordova.getContext();
  }

  private WebViewInstance requireInstance(String id, CallbackContext callbackContext) {
    WebViewInstance instance = getInstance(id);
    if (instance == null) {
      callbackContext.error("WebView not found: " + id);
    }
    return instance;
  }

  private void loadURL(
    String id,
    String url,
    JSONObject headers,
    CallbackContext callbackContext
  ) {
    WebViewInstance instance = requireInstance(id, callbackContext);
    if (instance == null) return;
    instance.loadURL(url, headers, callbackContext);
  }

  private void loadHTML(
    String id,
    String html,
    JSONObject htmlOptions,
    CallbackContext callbackContext
  ) {
    WebViewInstance instance = requireInstance(id, callbackContext);
    if (instance == null) return;
    instance.loadHTML(html, htmlOptions, callbackContext);
  }

  private void evaluate(String id, String js, CallbackContext callbackContext) {
    WebViewInstance instance = requireInstance(id, callbackContext);
    if (instance == null) return;
    instance.evaluate(js, callbackContext);
  }

  private void postMessage(String id, String message, CallbackContext callbackContext) {
    WebViewInstance instance = requireInstance(id, callbackContext);
    if (instance == null) return;
    instance.postMessage(message, callbackContext);
  }

  private void show(String id, CallbackContext callbackContext) {
    WebViewInstance instance = requireInstance(id, callbackContext);
    if (instance == null) return;
    instance.show(callbackContext);
  }

  private void hide(String id, CallbackContext callbackContext) {
    WebViewInstance instance = requireInstance(id, callbackContext);
    if (instance == null) return;
    instance.hide(callbackContext);
  }

  private void reload(String id, CallbackContext callbackContext) {
    WebViewInstance instance = requireInstance(id, callbackContext);
    if (instance == null) return;
    instance.reload(callbackContext);
  }

  private void stopLoading(String id, CallbackContext callbackContext) {
    WebViewInstance instance = requireInstance(id, callbackContext);
    if (instance == null) return;
    instance.stopLoading(callbackContext);
  }

  private void goBack(String id, CallbackContext callbackContext) {
    WebViewInstance instance = requireInstance(id, callbackContext);
    if (instance == null) return;
    instance.goBack(callbackContext);
  }

  private void goForward(String id, CallbackContext callbackContext) {
    WebViewInstance instance = requireInstance(id, callbackContext);
    if (instance == null) return;
    instance.goForward(callbackContext);
  }

  private void canGoBack(String id, CallbackContext callbackContext) {
    WebViewInstance instance = requireInstance(id, callbackContext);
    if (instance == null) return;
    instance.canGoBack(callbackContext);
  }

  private void canGoForward(String id, CallbackContext callbackContext) {
    WebViewInstance instance = requireInstance(id, callbackContext);
    if (instance == null) return;
    instance.canGoForward(callbackContext);
  }

  private void clearCache(String id, boolean includeDiskFiles, CallbackContext callbackContext) {
    WebViewInstance instance = requireInstance(id, callbackContext);
    if (instance == null) return;
    instance.clearCache(includeDiskFiles, callbackContext);
  }

  private void clearHistory(String id, CallbackContext callbackContext) {
    WebViewInstance instance = requireInstance(id, callbackContext);
    if (instance == null) return;
    instance.clearHistory(callbackContext);
  }

  private void clearFormData(String id, CallbackContext callbackContext) {
    WebViewInstance instance = requireInstance(id, callbackContext);
    if (instance == null) return;
    instance.clearFormData(callbackContext);
  }

  private void setUserAgent(
    String id,
    String userAgent,
    String mode,
    CallbackContext callbackContext
  ) {
    WebViewInstance instance = requireInstance(id, callbackContext);
    if (instance == null) return;
    instance.setUserAgent(userAgent, mode, callbackContext);
  }

  private void getUserAgent(String id, CallbackContext callbackContext) {
    WebViewInstance instance = requireInstance(id, callbackContext);
    if (instance == null) return;
    instance.getUserAgent(callbackContext);
  }

  private void updateSettings(String id, JSONObject settings, CallbackContext callbackContext) {
    WebViewInstance instance = requireInstance(id, callbackContext);
    if (instance == null) return;
    instance.updateSettings(settings, callbackContext);
  }

  private void getSettings(String id, CallbackContext callbackContext) {
    WebViewInstance instance = requireInstance(id, callbackContext);
    if (instance == null) return;
    instance.getSettings(callbackContext);
  }

  private void getInfo(String id, CallbackContext callbackContext) {
    WebViewInstance instance = requireInstance(id, callbackContext);
    if (instance == null) return;
    instance.getInfo(callbackContext);
  }

  private void destroy(String id, final CallbackContext callbackContext) {
    final WebViewInstance instance = instances.remove(id);
    if (instance == null) {
      callbackContext.error("WebView not found: " + id);
      return;
    }

    cordova.getActivity().runOnUiThread(() -> {
      instance.destroy();
      callbackContext.success();
    });
  }

  /** Feature probes for the JS layer. */
  private JSONObject capabilities() {
    JSONObject result = new JSONObject();
    try {
      result.put("version", PLUGIN_VERSION);
      result.put("multiProfile", ProfileManager.isSupported());
      result.put("deleteBrowsingData", ProfileManager.canDeleteBrowsingData());
      result.put("documentStartScript", isSupported(WebViewFeature.DOCUMENT_START_SCRIPT));
      result.put("safeBrowsing", isSupported(WebViewFeature.SAFE_BROWSING_ENABLE));
      result.put("algorithmicDarkening", isSupported(WebViewFeature.ALGORITHMIC_DARKENING));
    } catch (JSONException e) {
      Log.e(TAG, "Error building capabilities", e);
    }
    return result;
  }

  private static boolean isSupported(String feature) {
    try {
      return WebViewFeature.isFeatureSupported(feature);
    } catch (Throwable t) {
      return false;
    }
  }

  /**
   * Starts a confirmed download via the system DownloadManager into the public
   * Downloads directory. Cookies come from the originating instance's profile
   * cookie jar, so isolated-profile sessions are neither dropped nor crossed
   * with the default profile. Returns whether the download was enqueued.
   */
  boolean download(
    WebViewInstance instance,
    String url,
    String userAgent,
    String mimeType,
    String fileName
  ) {
    Context context = cordova.getActivity();
    try {
      DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
      request.setMimeType(mimeType);
      if (userAgent != null && !userAgent.isEmpty()) {
        request.addRequestHeader("User-Agent", userAgent);
      }
      CookieManager cookieManager = instance != null
        ? instance.getCookieManager()
        : CookieManager.getInstance();
      String cookie = cookieManager != null ? cookieManager.getCookie(url) : null;
      if (cookie != null && !cookie.isEmpty()) {
        request.addRequestHeader("Cookie", cookie);
      }
      request.setDescription("Downloading file...");
      request.setTitle(fileName);
      request.allowScanningByMediaScanner();
      request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
      request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName);

      DownloadManager dm = (DownloadManager) context.getSystemService(Context.DOWNLOAD_SERVICE);
      if (dm == null) {
        throw new IllegalStateException("DownloadManager unavailable");
      }
      dm.enqueue(request);
      Toast.makeText(context, "Download started...", Toast.LENGTH_SHORT).show();
      return true;
    } catch (Exception e) {
      Log.e(TAG, "Download failed", e);
      Toast.makeText(context, "Download failed", Toast.LENGTH_SHORT).show();
      return false;
    }
  }

  public void sendMessageToCordova(String id, String message) {
    try {
      JSONObject payload = new JSONObject();
      payload.put("id", id);
      payload.put("message", message);
      sendPayload(payload);
    } catch (JSONException e) {
      Log.e(TAG, "Error building message payload", e);
    }
  }

  public void sendEventToCordova(String id, String event, JSONObject data) {
    try {
      JSONObject payload = new JSONObject();
      payload.put("id", id);
      payload.put("event", event);
      if (data != null) {
        payload.put("data", data);
      }
      sendPayload(payload);
    } catch (JSONException e) {
      Log.e(TAG, "Error building event payload", e);
    }
  }

  private void sendPayload(JSONObject payload) {
    if (messageCallback == null) return;
    PluginResult result = new PluginResult(PluginResult.Status.OK, payload);
    result.setKeepCallback(true);
    messageCallback.sendPluginResult(result);
  }

  @Override
  public void onReset() {
    super.onReset();
    // The host WebView navigated and rebuilt its JS world, so the previous
    // keep-callback is dead. The reloaded page registers a fresh one.
    messageCallback = null;
  }

  @Override
  public void onDestroy() {
    super.onDestroy();
    // Copy: destroying a fullscreen instance finishes its activity, whose
    // onDestroy() removes it from the map.
    for (WebViewInstance instance : new ArrayList<>(instances.values())) {
      try {
        instance.destroy();
      } catch (Exception ignored) {}
    }
    instances.clear();
    instance = null;
  }
}

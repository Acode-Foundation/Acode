package com.foxdebug.webview;

import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Environment;
import android.util.Log;
import android.webkit.CookieManager;
import android.widget.Toast;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.UUID;
import org.apache.cordova.CallbackContext;
import org.apache.cordova.CordovaPlugin;
import org.apache.cordova.PluginResult;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

public class WebViewPlugin extends CordovaPlugin {

  private static final String TAG = "AcodeWebView";
  private static WebViewPlugin instance;

  private final HashMap<String, WebViewInstance> instances = new HashMap<>();
  private CallbackContext messageCallback;

  @Override
  protected void pluginInitialize() {
    instance = this;
  }

  public static WebViewPlugin getInstance() {
    return instance;
  }

  @Override
  public boolean execute(String action, JSONArray args, CallbackContext callbackContext) throws JSONException {
    try {
      switch (action) {
        case "setMessageCallback":
          this.messageCallback = callbackContext;
          PluginResult keepResult = new PluginResult(PluginResult.Status.NO_RESULT);
          keepResult.setKeepCallback(true);
          callbackContext.sendPluginResult(keepResult);
          return true;
        case "create":
          create(args.getJSONObject(0), callbackContext);
          return true;
        case "loadURL":
          loadURL(args.getString(0), args.getString(1), callbackContext);
          return true;
        case "loadHTML":
          loadHTML(args.getString(0), args.getString(1), callbackContext);
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
        case "setUserAgent":
          setUserAgent(args.getString(0), args.getString(1), callbackContext);
          return true;
        case "destroy":
          destroy(args.getString(0), callbackContext);
          return true;
        default:
          callbackContext.error("Unknown action: " + action);
          return true;
      }
    } catch (Exception e) {
      Log.e(TAG, "Error: " + action, e);
      callbackContext.error(e.getMessage());
    }
    return true;
  }

  private String generateId() {
    return "wv_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
  }

  private void create(JSONObject options, final CallbackContext callbackContext) throws JSONException {
    final String id = generateId();
    final String mode = options.optString("mode", "hidden");
    final String title = options.optString("title", "");
    final boolean allowNavigation = options.optBoolean("allowNavigation", true);
    final boolean allowDownloads = options.optBoolean("allowDownloads", false);
    final boolean visible = options.optBoolean("visible", true);
    final boolean incognito = options.optBoolean("incognito", true);
    // optString() turns an explicit JSON null into the literal "null" string;
    // isNull() covers both a missing key and a real null.
    final String userAgent = options.isNull("userAgent") ? null : options.optString("userAgent", null);

    cordova.getActivity().runOnUiThread(new Runnable() {
      @Override
      public void run() {
        WebViewInstance instance = new WebViewInstance(
          id, mode, title,
          allowNavigation, allowDownloads,
          incognito, userAgent,
          WebViewPlugin.this
        );
        instances.put(id, instance);

        try {
          if (instance.isFullscreen()) {
            // The WebView is created lazily by WebViewActivity. When the
            // caller asked for an initially hidden instance, the launch is
            // deferred until show() is called.
            if (visible) {
              showFullscreenActivity(id);
            }
          } else {
            // "hidden" mode: a headless WebView that is never displayed.
            instance.createWebView(cordova.getActivity());
          }
          callbackContext.success(id);
        } catch (Exception e) {
          instances.remove(id);
          try {
            instance.destroy();
          } catch (Exception ignored) {}
          Log.e(TAG, "Create error: " + e.getMessage(), e);
          callbackContext.error(e.getMessage());
        }
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

  private void loadURL(String id, String url, CallbackContext callbackContext) {
    WebViewInstance instance = getInstance(id);
    if (instance == null) { callbackContext.error("WebView not found: " + id); return; }
    instance.loadURL(url, callbackContext);
  }

  private void loadHTML(String id, String html, CallbackContext callbackContext) {
    WebViewInstance instance = getInstance(id);
    if (instance == null) { callbackContext.error("WebView not found: " + id); return; }
    instance.loadHTML(html, callbackContext);
  }

  private void evaluate(String id, String js, CallbackContext callbackContext) {
    WebViewInstance instance = getInstance(id);
    if (instance == null) { callbackContext.error("WebView not found: " + id); return; }
    instance.evaluate(js, callbackContext);
  }

  private void postMessage(String id, String message, CallbackContext callbackContext) {
    WebViewInstance instance = getInstance(id);
    if (instance == null) { callbackContext.error("WebView not found: " + id); return; }
    instance.postMessage(message, callbackContext);
  }

  private void show(String id, CallbackContext callbackContext) {
    WebViewInstance instance = getInstance(id);
    if (instance == null) { callbackContext.error("WebView not found: " + id); return; }
    instance.show(callbackContext);
  }

  private void hide(String id, CallbackContext callbackContext) {
    WebViewInstance instance = getInstance(id);
    if (instance == null) { callbackContext.error("WebView not found: " + id); return; }
    instance.hide(callbackContext);
  }

  private void reload(String id, CallbackContext callbackContext) {
    WebViewInstance instance = getInstance(id);
    if (instance == null) { callbackContext.error("WebView not found: " + id); return; }
    instance.reload(callbackContext);
  }

  private void setUserAgent(String id, String userAgent, CallbackContext callbackContext) {
    WebViewInstance instance = getInstance(id);
    if (instance == null) { callbackContext.error("WebView not found: " + id); return; }
    instance.setUserAgent(userAgent, callbackContext);
  }

  private void destroy(String id, final CallbackContext callbackContext) {
    final WebViewInstance instance = instances.remove(id);
    if (instance == null) { callbackContext.error("WebView not found: " + id); return; }

    cordova.getActivity().runOnUiThread(new Runnable() {
      @Override
      public void run() {
        instance.destroy();
        callbackContext.success();
      }
    });
  }

  /**
   * Starts a confirmed download via the system DownloadManager into the
   * public Downloads directory. The WebView's cookies are forwarded so
   * authenticated downloads work.
   */
  void download(String url, String userAgent, String mimeType, String fileName) {
    Context context = cordova.getActivity();
    try {
      DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
      request.setMimeType(mimeType);
      request.addRequestHeader("User-Agent", userAgent);
      String cookie = CookieManager.getInstance().getCookie(url);
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
    } catch (Exception e) {
      Log.e(TAG, "Download failed", e);
      Toast.makeText(context, "Download failed", Toast.LENGTH_SHORT).show();
    }
  }

  public void sendMessageToCordova(String id, String message) {
    if (messageCallback == null) return;

    try {
      JSONObject payload = new JSONObject();
      payload.put("id", id);
      payload.put("message", message);

      PluginResult result = new PluginResult(PluginResult.Status.OK, payload);
      result.setKeepCallback(true);
      messageCallback.sendPluginResult(result);
    } catch (JSONException e) {
      Log.e(TAG, "Error building message payload", e);
    }
  }

  public void sendEventToCordova(String id, String event, JSONObject data) {
    if (messageCallback == null) return;

    try {
      JSONObject payload = new JSONObject();
      payload.put("id", id);
      payload.put("event", event);
      if (data != null) {
        payload.put("data", data);
      }

      PluginResult result = new PluginResult(PluginResult.Status.OK, payload);
      result.setKeepCallback(true);
      messageCallback.sendPluginResult(result);
    } catch (JSONException e) {
      Log.e(TAG, "Error building event payload", e);
    }
  }

  @Override
  public void onDestroy() {
    super.onDestroy();
    // Copy: destroying a fullscreen instance finishes its activity, whose
    // onDestroy() removes it from the map.
    for (WebViewInstance instance : new ArrayList<>(instances.values())) {
      try { instance.destroy(); } catch (Exception ignored) {}
    }
    instances.clear();
    instance = null;
  }
}

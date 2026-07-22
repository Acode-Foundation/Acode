package com.foxdebug.webview;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
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
    final String title = options.optString("title", "WebView");
    final int width = options.optInt("width", 0);
    final int height = options.optInt("height", 0);
    final int x = options.optInt("x", 0);
    final int y = options.optInt("y", 0);
    final boolean allowNavigation = options.optBoolean("allowNavigation", true);
    final boolean allowDownloads = options.optBoolean("allowDownloads", false);
    final boolean visible = options.optBoolean("visible", true);

    final String effectiveMode = visible ? mode : "hidden";

    cordova.getActivity().runOnUiThread(new Runnable() {
      @Override
      public void run() {
        try {
          WebViewInstance instance = new WebViewInstance(
            id, effectiveMode, title,
            width, height, x, y,
            allowNavigation, allowDownloads,
            visible, cordova.getActivity(),
            WebViewPlugin.this
          );

          if (effectiveMode.equals("fullscreen")) {
            instances.put(id, instance);
            launchFullscreenActivity(id, title, allowNavigation, allowDownloads);
            callbackContext.success(id);
            return;
          }

          instance.createWebView(cordova.getActivity());

          if (effectiveMode.equals("window") || effectiveMode.equals("panel")) {
            instance.attachToActivity(cordova.getActivity());
          }

          instances.put(id, instance);
          callbackContext.success(id);
        } catch (Exception e) {
          Log.e(TAG, "Create error: " + e.getMessage(), e);
          callbackContext.error(e.getMessage());
        }
      }
    });
  }

  private void launchFullscreenActivity(
    String id, String title, boolean allowNavigation, boolean allowDownloads
  ) {
    Intent intent = new Intent(cordova.getActivity(), WebViewActivity.class);
    intent.putExtra("webviewId", id);
    intent.putExtra("title", title);
    intent.putExtra("allowNavigation", allowNavigation);
    intent.putExtra("allowDownloads", allowDownloads);
    cordova.getActivity().startActivity(intent);
  }

  public WebViewInstance getInstance(String id) {
    return instances.get(id);
  }

  private void loadURL(String id, String url, CallbackContext callbackContext) {
    WebViewInstance instance = getInstance(id);
    if (instance == null) { callbackContext.error("WebView not found: " + id); return; }
    instance.loadURL(url);
    callbackContext.success();
  }

  private void loadHTML(String id, String html, CallbackContext callbackContext) {
    WebViewInstance instance = getInstance(id);
    if (instance == null) { callbackContext.error("WebView not found: " + id); return; }
    instance.loadHTML(html);
    callbackContext.success();
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

  private void destroy(String id, CallbackContext callbackContext) {
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
    for (WebViewInstance instance : instances.values()) {
      try { instance.destroy(); } catch (Exception ignored) {}
    }
    instances.clear();
    instance = null;
  }
}

package com.foxdebug.webview;

import android.app.Activity;
import android.content.DialogInterface;
import android.graphics.Color;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.DownloadListener;
import android.webkit.JavascriptInterface;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.Context;
import android.net.Uri;
import android.os.Environment;
import android.widget.FrameLayout;
import android.widget.Toast;
import org.apache.cordova.CallbackContext;
import org.json.JSONException;
import org.json.JSONObject;

public class WebViewInstance {

  private static final String TAG = "WebViewInstance";

  final String id;
  final String mode;
  final String title;
  final int width;
  final int height;
  final int x;
  final int y;
  final boolean allowNavigation;
  final boolean allowDownloads;
  final boolean initiallyVisible;
  final WebViewPlugin plugin;

  private WebView webView;
  private FrameLayout container;
  private boolean isDestroyed = false;

  WebViewInstance(
    String id, String mode, String title,
    int width, int height, int x, int y,
    boolean allowNavigation, boolean allowDownloads,
    boolean initiallyVisible,
    Activity activity,
    WebViewPlugin plugin
  ) {
    this.id = id;
    this.mode = mode;
    this.title = title;
    this.width = width;
    this.height = height;
    this.x = x;
    this.y = y;
    this.allowNavigation = allowNavigation;
    this.allowDownloads = allowDownloads;
    this.initiallyVisible = initiallyVisible;
    this.plugin = plugin;
  }

  public WebView getWebView() {
    return webView;
  }

  void createWebView(Activity activity) {
    webView = new WebView(activity);

    WebSettings settings = webView.getSettings();
    settings.setJavaScriptEnabled(true);
    settings.setDomStorageEnabled(true);
    settings.setAllowContentAccess(true);
    settings.setDisplayZoomControls(false);
    settings.setLoadWithOverviewMode(true);
    settings.setUseWideViewPort(true);
    settings.setAllowFileAccess(true);
    settings.setAllowFileAccessFromFileURLs(true);
    settings.setAllowUniversalAccessFromFileURLs(true);

    webView.setWebViewClient(new InstanceWebViewClient());
    webView.setWebChromeClient(new InstanceWebChromeClient());
    webView.setFocusable(true);
    webView.setFocusableInTouchMode(true);

    webView.addJavascriptInterface(new JsBridge(), "AcodeWebViewNative");

    if (allowDownloads) {
      webView.setDownloadListener(new InstanceDownloadListener(activity));
    }

    String bridgeJs =
      "(function() {" +
      "  window.webview = window.webview || {};" +
      "  window.webview._callbacks = [];" +
      "  window.webview.onMessage = function(cb) { window.webview._callbacks.push(cb); };" +
      "  window.webview.postMessage = function(msg) {" +
      "    var data = typeof msg === 'string' ? msg : JSON.stringify(msg);" +
      "    window.AcodeWebViewNative.postMessage(data);" +
      "  };" +
      "  window.webview.offMessage = function(cb) {" +
      "    window.webview._callbacks = window.webview._callbacks.filter(function(c) { return c !== cb; });" +
      "  };" +
      "})();";

    webView.evaluateJavascript(bridgeJs, null);
  }

  void attachToActivity(Activity activity) {
    container = new FrameLayout(activity);

    FrameLayout.LayoutParams webViewParams = new FrameLayout.LayoutParams(
      ViewGroup.LayoutParams.MATCH_PARENT,
      ViewGroup.LayoutParams.MATCH_PARENT
    );

    container.setBackgroundColor(Color.argb(180, 0, 0, 0));

    if (mode.equals("window")) {
      int w = width > 0 ? width : ViewGroup.LayoutParams.WRAP_CONTENT;
      int h = height > 0 ? height : ViewGroup.LayoutParams.WRAP_CONTENT;

      webViewParams = new FrameLayout.LayoutParams(
        w > 0 ? dpToPx(activity, w) : ViewGroup.LayoutParams.MATCH_PARENT,
        h > 0 ? dpToPx(activity, h) : ViewGroup.LayoutParams.MATCH_PARENT
      );
      webViewParams.gravity = Gravity.CENTER;
      webViewParams.setMargins(dpToPx(activity, 16), dpToPx(activity, 48), dpToPx(activity, 16), dpToPx(activity, 48));

      container.setOnClickListener(new View.OnClickListener() {
        @Override
        public void onClick(View v) {
          hideInner();
        }
      });
    } else if (mode.equals("panel")) {
      webViewParams = new FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        height > 0 ? dpToPx(activity, height) : (int)(getScreenHeight(activity) * 0.4)
      );
      webViewParams.gravity = Gravity.BOTTOM;
    }

    container.addView(webView, webViewParams);

    ViewGroup rootView = activity.findViewById(android.R.id.content);
    if (rootView instanceof FrameLayout) {
      rootView.addView(container, new FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.MATCH_PARENT
      ));
    }
  }

  void loadURL(String url) {
    if (isDestroyed || webView == null) return;
    final String safeUrl = (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("file://"))
      ? url : "http://" + url;
    new Handler(Looper.getMainLooper()).post(new Runnable() {
      @Override
      public void run() {
        webView.loadUrl(safeUrl);
      }
    });
  }

  void loadHTML(String html) {
    if (isDestroyed || webView == null) return;
    new Handler(Looper.getMainLooper()).post(new Runnable() {
      @Override
      public void run() {
        webView.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
      }
    });
  }

  void evaluate(String js, final CallbackContext callbackContext) {
    if (isDestroyed || webView == null) {
      callbackContext.error("WebView destroyed");
      return;
    }
    new Handler(Looper.getMainLooper()).post(new Runnable() {
      @Override
      public void run() {
        webView.evaluateJavascript(js, new ValueCallback<String>() {
          @Override
          public void onReceiveValue(String value) {
            if (value != null && value.startsWith("\"") && value.endsWith("\"")) {
              value = value.substring(1, value.length() - 1)
                .replace("\\\"", "\"")
                .replace("\\\\", "\\");
            }
            callbackContext.success(value);
          }
        });
      }
    });
  }

  void postMessage(String message, CallbackContext callbackContext) {
    if (isDestroyed || webView == null) {
      callbackContext.error("WebView destroyed");
      return;
    }
    String escaped = message
      .replace("\\", "\\\\")
      .replace("'", "\\'")
      .replace("\n", "\\n")
      .replace("\r", "\\r");

    String js = "if(window.webview&&window.webview._callbacks){" +
      "var msg=" + safeParseJSON(message) + ";" +
      "window.webview._callbacks.forEach(function(cb){try{cb(msg)}catch(e){console.error(e)}});" +
      "}";

    new Handler(Looper.getMainLooper()).post(new Runnable() {
      @Override
      public void run() {
        webView.evaluateJavascript(js, null);
        callbackContext.success();
      }
    });
  }

  private String safeParseJSON(String message) {
    try {
      new JSONObject(message);
      return message;
    } catch (JSONException e1) {
      try {
        new org.json.JSONArray(message);
        return message;
      } catch (JSONException e2) {
        return "\"" + message.replace("\"", "\\\"").replace("\n", "\\n") + "\"";
      }
    }
  }

  void show(final CallbackContext callbackContext) {
    new Handler(Looper.getMainLooper()).post(new Runnable() {
      @Override
      public void run() {
        if (isDestroyed || container == null) {
          if (callbackContext != null) callbackContext.error("Cannot show");
          return;
        }
        container.setVisibility(View.VISIBLE);
        if (callbackContext != null) callbackContext.success();
      }
    });
  }

  void hide(final CallbackContext callbackContext) {
    new Handler(Looper.getMainLooper()).post(new Runnable() {
      @Override
      public void run() {
        if (isDestroyed || container == null) {
          if (callbackContext != null) callbackContext.error("Cannot hide");
          return;
        }
        container.setVisibility(View.GONE);
        if (callbackContext != null) callbackContext.success();
      }
    });
  }

  private void hideInner() {
    if (container != null) {
      container.setVisibility(View.GONE);
    }
  }

  void reload(CallbackContext callbackContext) {
    if (isDestroyed || webView == null) {
      callbackContext.error("WebView destroyed");
      return;
    }
    new Handler(Looper.getMainLooper()).post(new Runnable() {
      @Override
      public void run() {
        webView.reload();
        callbackContext.success();
      }
    });
  }

  void destroy() {
    isDestroyed = true;

    new Handler(Looper.getMainLooper()).post(new Runnable() {
      @Override
      public void run() {
        if (container != null && container.getParent() != null) {
          ((ViewGroup) container.getParent()).removeView(container);
        }
        if (webView != null) {
          webView.removeJavascriptInterface("AcodeWebViewNative");
          webView.setWebViewClient(null);
          webView.setWebChromeClient(null);
          webView.loadUrl("about:blank");
          webView.destroy();
        }
        webView = null;
        container = null;
      }
    });
  }

  void onPageFinished() {
    try {
      JSONObject data = new JSONObject();
      data.put("url", webView.getUrl());
      data.put("title", webView.getTitle());
      plugin.sendEventToCordova(id, "pageFinished", data);
    } catch (Exception e) {
      Log.e(TAG, "onPageFinished error", e);
    }
  }

  private static int dpToPx(Context context, int dp) {
    return (int) (dp * context.getResources().getDisplayMetrics().density);
  }

  private static int getScreenHeight(Activity activity) {
    return activity.getResources().getDisplayMetrics().heightPixels;
  }

  private class InstanceWebViewClient extends WebViewClient {
    @Override
    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
      if (!allowNavigation) {
        return true;
      }
      return false;
    }

    @Override
    public void onPageFinished(WebView view, String url) {
      super.onPageFinished(view, url);
      WebViewInstance.this.onPageFinished();
    }
  }

  private class InstanceWebChromeClient extends WebChromeClient {
    @Override
    public void onReceivedTitle(WebView view, String pageTitle) {
      super.onReceivedTitle(view, pageTitle);
      try {
        JSONObject data = new JSONObject();
        data.put("title", pageTitle);
        plugin.sendEventToCordova(id, "titleChanged", data);
      } catch (Exception e) {
        Log.e(TAG, "onReceivedTitle error", e);
      }
    }
  }

  private class InstanceDownloadListener implements DownloadListener {
    private final Context context;

    InstanceDownloadListener(Context context) {
      this.context = context;
    }

    @Override
    public void onDownloadStart(String url, String userAgent, String contentDisposition, String mimeType, long contentLength) {
      final String fileName = URLUtil.guessFileName(url, contentDisposition, mimeType);

      new Handler(Looper.getMainLooper()).post(new Runnable() {
        @Override
        public void run() {
          new AlertDialog.Builder(context)
            .setTitle("Download file")
            .setMessage("Do you want to download \"" + fileName + "\"?")
            .setPositiveButton("Yes", new DialogInterface.OnClickListener() {
              @Override
              public void onClick(DialogInterface dialog, int which) {
                DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
                request.setMimeType(mimeType);
                request.addRequestHeader("User-Agent", userAgent);
                request.setDescription("Downloading file...");
                request.setTitle(fileName);
                request.allowScanningByMediaScanner();
                request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName);

                DownloadManager dm = (DownloadManager) context.getSystemService(Context.DOWNLOAD_SERVICE);
                dm.enqueue(request);
                Toast.makeText(context, "Download started...", Toast.LENGTH_SHORT).show();
              }
            })
            .setNegativeButton("Cancel", null)
            .show();
        }
      });
    }
  }

  public class JsBridge {
    @JavascriptInterface
    public void postMessage(String message) {
      plugin.sendMessageToCordova(id, message);
    }

    @JavascriptInterface
    public String getWebViewId() {
      return id;
    }
  }
}

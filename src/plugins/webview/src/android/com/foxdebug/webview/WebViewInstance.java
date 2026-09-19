package com.foxdebug.webview;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.DialogInterface;
import android.graphics.Bitmap;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.webkit.DownloadListener;
import android.webkit.JavascriptInterface;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.apache.cordova.CallbackContext;
import org.json.JSONException;
import org.json.JSONObject;
import org.json.JSONTokener;

public class WebViewInstance {

  private static final String TAG = "WebViewInstance";

  /**
   * Page-side messaging bridge. Injected on page started (best effort, runs
   * before page scripts in most cases) and again on page finished (guaranteed).
   * It is idempotent and non-destructive: the guard keeps callbacks registered
   * by the page between the two injections intact.
   */
  private static final String BRIDGE_JS =
    "(function(){" +
    "if(window.webview&&window.webview.__acodeBridge){return;}" +
    "var callbacks=[];" +
    "window.webview={" +
    "__acodeBridge:true," +
    "onMessage:function(cb){if(typeof cb==='function'){callbacks.push(cb);}}," +
    "offMessage:function(cb){callbacks=callbacks.filter(function(c){return c!==cb;});}," +
    "postMessage:function(msg){" +
    "var data=(typeof msg==='string')?msg:JSON.stringify(msg);" +
    "window.AcodeWebViewNative.postMessage(String(data));" +
    "}," +
    "_dispatch:function(msg){" +
    "callbacks.slice().forEach(function(cb){try{cb(msg);}catch(e){console.error(e);}});" +
    "}" +
    "};" +
    "})();";

  final String id;
  final String mode;
  final String title;
  final boolean allowNavigation;
  final boolean allowDownloads;
  final boolean incognito;
  final WebViewPlugin plugin;

  /**
   * Custom User-Agent override, or null for the system default. Applied when
   * the WebView is created and updated via {@link #setUserAgent}.
   */
  String userAgent;

  private WebView webView;
  /** The activity hosting this instance in fullscreen mode, while alive. */
  private WebViewActivity hostingActivity = null;
  private boolean isDestroyed = false;
  /** Content requested before the fullscreen WebView exists yet. */
  private String pendingUrl = null;
  private String pendingHtml = null;

  WebViewInstance(
    String id, String mode, String title,
    boolean allowNavigation, boolean allowDownloads,
    boolean incognito, String userAgent,
    WebViewPlugin plugin
  ) {
    this.id = id;
    this.mode = mode;
    this.title = title;
    this.allowNavigation = allowNavigation;
    this.allowDownloads = allowDownloads;
    this.incognito = incognito;
    this.userAgent = (userAgent == null || userAgent.isEmpty()) ? null : userAgent;
    this.plugin = plugin;
  }

  public WebView getWebView() {
    return webView;
  }

  String getTitle() {
    return title;
  }

  boolean isFullscreen() {
    return "fullscreen".equals(mode);
  }

  WebViewActivity getHostingActivity() {
    return hostingActivity;
  }

  void setHostingActivity(WebViewActivity activity) {
    hostingActivity = activity;
  }

  void clearHostingActivity(WebViewActivity activity) {
    if (hostingActivity == activity) {
      hostingActivity = null;
    }
  }

  void createWebView(Activity activity) {
    // Idempotent: a recreated hosting activity reuses the existing WebView
    // (and its page state) instead of leaking one instance per recreation.
    if (webView != null) return;
    webView = new WebView(activity);

    WebSettings settings = webView.getSettings();
    settings.setJavaScriptEnabled(true);
    settings.setDomStorageEnabled(true);
    // Isolation: hosted content must not reach app/device data. File and
    // content scheme access stay disabled, and loadURL()/navigation below
    // only allow http(s), so these cannot be bypassed with a crafted URL.
    settings.setAllowFileAccess(false);
    settings.setAllowContentAccess(false);
    setFileUrlAccessFlags(settings);
    settings.setDisplayZoomControls(false);
    settings.setLoadWithOverviewMode(true);
    settings.setUseWideViewPort(true);

    if (incognito) {
      // Never serve from the HTTP cache. Note: Android WebView exposes no
      // per-view "don't store" mode, and its disk cache is shared with the
      // host app, so we deliberately do NOT clear it here — wiping it would
      // evict the main app WebView's cache too. History and form data are
      // per-view and are cleared on destroy() below. Cookies live in the
      // app-wide CookieManager singleton (shared with the host app), so
      // per-instance cookie incognito is not possible on this platform.
      settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
    }
    if (userAgent != null) {
      settings.setUserAgentString(userAgent);
    }

    webView.setWebViewClient(new InstanceWebViewClient());
    webView.setWebChromeClient(new InstanceWebChromeClient());
    webView.setFocusable(true);
    webView.setFocusableInTouchMode(true);

    webView.addJavascriptInterface(new JsBridge(), "AcodeWebViewNative");

    if (allowDownloads) {
      webView.setDownloadListener(new InstanceDownloadListener(activity));
    }

    injectBridge(webView);

    // Apply content requested while the WebView did not exist yet
    // (fullscreen instances are created lazily by WebViewActivity).
    if (pendingUrl != null) {
      webView.loadUrl(pendingUrl);
      pendingUrl = null;
      pendingHtml = null;
    } else if (pendingHtml != null) {
      webView.loadDataWithBaseURL(null, pendingHtml, "text/html", "UTF-8", null);
      pendingHtml = null;
    }
  }

  @SuppressWarnings("deprecation")
  private static void setFileUrlAccessFlags(WebSettings settings) {
    settings.setAllowFileAccessFromFileURLs(false);
    settings.setAllowUniversalAccessFromFileURLs(false);
  }

  private static void injectBridge(WebView view) {
    view.evaluateJavascript(BRIDGE_JS, null);
  }

  /**
   * Pads the view so content stays clear of the status and navigation bars.
   * Required on API 35+ where edge-to-edge is enforced for the app; on older
   * versions the window usually consumes the insets first, making the padding
   * zero and this a no-op.
   */
  @SuppressWarnings("deprecation")
  static void applySystemBarInsets(final View view) {
    view.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
      @Override
      public WindowInsets onApplyWindowInsets(View v, WindowInsets insets) {
        int left, top, right, bottom;
        if (Build.VERSION.SDK_INT >= 30) {
          Insets bars = insets.getInsets(WindowInsets.Type.systemBars());
          left = bars.left;
          top = bars.top;
          right = bars.right;
          bottom = bars.bottom;
        } else {
          left = insets.getSystemWindowInsetLeft();
          top = insets.getSystemWindowInsetTop();
          right = insets.getSystemWindowInsetRight();
          bottom = insets.getSystemWindowInsetBottom();
        }
        v.setPadding(left, top, right, bottom);
        return insets;
      }
    });
  }

  private static final Pattern SCHEME_PATTERN =
    Pattern.compile("^([a-zA-Z][a-zA-Z0-9+\\-.]*)://");

  /**
   * Allows only http and https URLs, so hosted pages can never reach local
   * files, app content providers or execute javascript: URLs. Input without
   * a "scheme://" prefix ("example.com", "localhost:8080/page") is treated
   * as a host and loaded over https; anything that is not clearly a URL
   * degrades into a harmless failed https load.
   */
  private static String sanitizeUrl(String url) {
    if (url == null) return null;
    String trimmed = url.trim();
    if (trimmed.isEmpty()) return null;
    Matcher matcher = SCHEME_PATTERN.matcher(trimmed);
    if (matcher.find()) {
      String scheme = matcher.group(1);
      if (scheme.equalsIgnoreCase("http") || scheme.equalsIgnoreCase("https")) {
        return trimmed;
      }
      return null; // file://, content://, intent://, etc.
    }
    return "https://" + trimmed;
  }

  void loadURL(String url, final CallbackContext callbackContext) {
    if (isDestroyed) {
      callbackContext.error("WebView has been destroyed");
      return;
    }

    final String safeUrl = sanitizeUrl(url);
    if (safeUrl == null) {
      callbackContext.error("Blocked URL: only http:// and https:// URLs are allowed");
      return;
    }

    // Fullscreen instances create their WebView lazily in WebViewActivity.
    if (webView == null) {
      pendingUrl = safeUrl;
      pendingHtml = null;
      callbackContext.success();
      return;
    }

    runOnUiThread(new Runnable() {
      @Override
      public void run() {
        webView.loadUrl(safeUrl);
        callbackContext.success();
      }
    });
  }

  void loadHTML(final String html, final CallbackContext callbackContext) {
    if (isDestroyed) {
      callbackContext.error("WebView has been destroyed");
      return;
    }

    if (webView == null) {
      pendingHtml = html;
      pendingUrl = null;
      callbackContext.success();
      return;
    }

    runOnUiThread(new Runnable() {
      @Override
      public void run() {
        webView.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
        callbackContext.success();
      }
    });
  }

  /**
   * Overrides the User-Agent for this instance. Takes effect immediately
   * when the WebView exists; otherwise it is stored and applied when the
   * WebView is created (fullscreen instances are created lazily).
   */
  void setUserAgent(final String ua, final CallbackContext callbackContext) {
    if (isDestroyed) {
      callbackContext.error("WebView has been destroyed");
      return;
    }
    if (ua == null || ua.trim().isEmpty()) {
      callbackContext.error("User agent must not be empty");
      return;
    }
    userAgent = ua;
    if (webView == null) {
      callbackContext.success();
      return;
    }
    runOnUiThread(new Runnable() {
      @Override
      public void run() {
        webView.getSettings().setUserAgentString(userAgent);
        callbackContext.success();
      }
    });
  }

  void evaluate(String js, final CallbackContext callbackContext) {
    if (isDestroyed) {
      callbackContext.error("WebView has been destroyed");
      return;
    }
    if (webView == null) {
      callbackContext.error("WebView is not ready");
      return;
    }
    runOnUiThread(new Runnable() {
      @Override
      public void run() {
        webView.evaluateJavascript(js, new ValueCallback<String>() {
          @Override
          public void onReceiveValue(String value) {
            callbackContext.success(decodeJsResult(value));
          }
        });
      }
    });
  }

  /**
   * evaluateJavascript() delivers the result as a JSON-encoded string.
   * Decode it properly instead of stripping quotes by hand so escapes
   * (newlines, unicode, quotes) survive the round trip.
   */
  private static String decodeJsResult(String value) {
    if (value == null) return null;
    try {
      Object parsed = new JSONTokener(value).nextValue();
      if (parsed == JSONObject.NULL) return null;
      return String.valueOf(parsed);
    } catch (JSONException e) {
      return value;
    }
  }

  void postMessage(String message, final CallbackContext callbackContext) {
    if (isDestroyed) {
      callbackContext.error("WebView has been destroyed");
      return;
    }
    if (webView == null) {
      callbackContext.error("WebView is not ready");
      return;
    }

    // JSONObject.quote() produces a safe JS string literal for any input,
    // so a malicious or sloppy payload cannot break out of the string and
    // inject code into the page context. The page receives a parsed value
    // for JSON payloads and the raw string otherwise.
    final String js =
      "(function(){" +
      "var raw=" + JSONObject.quote(message) + ";" +
      "var msg;try{msg=JSON.parse(raw);}catch(e){msg=raw;}" +
      "if(window.webview&&window.webview._dispatch){window.webview._dispatch(msg);}" +
      "})();";

    runOnUiThread(new Runnable() {
      @Override
      public void run() {
        webView.evaluateJavascript(js, null);
        callbackContext.success();
      }
    });
  }

  void show(final CallbackContext callbackContext) {
    if (isDestroyed) {
      callbackContext.error("WebView has been destroyed");
      return;
    }
    if (!isFullscreen()) {
      callbackContext.error("Hidden WebViews cannot be shown; use mode \"fullscreen\" to display content");
      return;
    }
    // Launches the hosting activity, or brings it back to the front if it
    // is still alive (e.g. after hide() backgrounded it).
    runOnUiThread(new Runnable() {
      @Override
      public void run() {
        plugin.showFullscreenActivity(id);
      }
    });
    callbackContext.success();
  }

  void hide(final CallbackContext callbackContext) {
    if (isDestroyed) {
      callbackContext.error("WebView has been destroyed");
      return;
    }
    if (!isFullscreen()) {
      // A hidden (headless) WebView is already hidden.
      callbackContext.success();
      return;
    }
    hideFullscreen(callbackContext);
  }

  /**
   * Hiding a fullscreen WebView moves its hosting activity (and its task)
   * to the background. Nothing is destroyed, so show() brings the same
   * WebView back with its page state intact. The instance is only destroyed
   * when the user actually closes it (back button/task removal) or when
   * destroy() is called.
   */
  private void hideFullscreen(CallbackContext callbackContext) {
    if (isDestroyed) {
      callbackContext.error("WebView has been destroyed");
      return;
    }
    runOnUiThread(new Runnable() {
      @Override
      public void run() {
        if (hostingActivity != null
          && !hostingActivity.isFinishing()
          && !hostingActivity.isDestroyed()) {
          hostingActivity.moveTaskToBack(true);
        }
      }
    });
    callbackContext.success();
  }

  void reload(final CallbackContext callbackContext) {
    if (isDestroyed) {
      callbackContext.error("WebView has been destroyed");
      return;
    }
    if (webView == null) {
      callbackContext.error("WebView is not ready");
      return;
    }
    runOnUiThread(new Runnable() {
      @Override
      public void run() {
        webView.reload();
        callbackContext.success();
      }
    });
  }

  void destroy() {
    if (isDestroyed) return;
    isDestroyed = true;

    // Finish the hosting fullscreen activity, if any. Its onDestroy() calls
    // destroy() again, which is a no-op now that isDestroyed is set.
    WebViewActivity hosting = hostingActivity;
    hostingActivity = null;
    if (hosting != null && !hosting.isFinishing()) {
      hosting.finish();
    }

    runOnUiThread(new Runnable() {
      @Override
      public void run() {
        if (webView != null) {
          if (webView.getParent() != null) {
            ((ViewGroup) webView.getParent()).removeView(webView);
          }
          webView.removeJavascriptInterface("AcodeWebViewNative");
          webView.setDownloadListener(null);
          webView.setWebChromeClient(null);
          webView.setWebViewClient(null);
          // Incognito cleanup: per-view state only. The shared disk cache
          // and the app-wide cookies are intentionally left alone (see
          // createWebView() for why).
          if (incognito) {
            webView.clearHistory();
            webView.clearFormData();
          }
          webView.loadUrl("about:blank");
          webView.destroy();
        }
        webView = null;
      }
    });
  }

  void onPageFinished(WebView view) {
    // Navigation replaced the page's JS context, so the bridge injected into
    // the previous document is gone. Re-inject (no-op if already present).
    injectBridge(view);
    try {
      JSONObject data = new JSONObject();
      String url = view.getUrl();
      String pageTitle = view.getTitle();
      data.put("url", url != null ? url : "");
      data.put("title", pageTitle != null ? pageTitle : "");
      plugin.sendEventToCordova(id, "pageFinished", data);
    } catch (JSONException e) {
      Log.e(TAG, "onPageFinished error", e);
    }
  }

  private static void runOnUiThread(Runnable runnable) {
    new Handler(Looper.getMainLooper()).post(runnable);
  }

  private class InstanceWebViewClient extends WebViewClient {
    @Override
    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
      return shouldBlockNavigation(request.getUrl());
    }

    @SuppressWarnings("deprecation")
    @Override
    public boolean shouldOverrideUrlLoading(WebView view, String url) {
      return shouldBlockNavigation(Uri.parse(url));
    }

    /**
     * Blocks all navigation when allowNavigation is false. Even when it is
     * true, only http(s) targets may load inside the WebView; other schemes
     * (file:, content:, intent:, javascript:, tel:, ...) are blocked so
     * hostile pages cannot escape the sandbox or launch other apps.
     */
    private boolean shouldBlockNavigation(Uri uri) {
      if (!allowNavigation) return true;
      String scheme = uri.getScheme();
      return scheme == null
        || !(scheme.equalsIgnoreCase("http") || scheme.equalsIgnoreCase("https"));
    }

    @Override
    public void onPageStarted(WebView view, String url, Bitmap favicon) {
      super.onPageStarted(view, url, favicon);
      // Best effort: gets the bridge in before the page's own scripts run.
      injectBridge(view);
      try {
        JSONObject data = new JSONObject();
        data.put("url", url != null ? url : "");
        plugin.sendEventToCordova(id, "pageStarted", data);
      } catch (JSONException e) {
        Log.e(TAG, "onPageStarted error", e);
      }
    }

    @Override
    public void onPageFinished(WebView view, String url) {
      super.onPageFinished(view, url);
      WebViewInstance.this.onPageFinished(view);
    }

    @Override
    public void onReceivedError(
      WebView view, WebResourceRequest request, WebResourceError error
    ) {
      // Do NOT call super.onReceivedError(view, request, error): the base
      // implementation forwards main-frame errors to the deprecated
      // onReceivedError() below via virtual dispatch, which would emit a
      // second, duplicate loadError for the same failure. This modern
      // callback is the canonical path (minSdk is 26, so API 23+ is
      // guaranteed); it emits directly and exactly once.
      // Sub-resource failures are noise here; only the main frame matters.
      if (request != null && !request.isForMainFrame()) return;
      Uri url = request != null ? request.getUrl() : null;
      int code = error != null ? error.getErrorCode() : -1;
      CharSequence description = error != null ? error.getDescription() : null;
      sendLoadError(
        url != null ? url.toString() : null,
        code,
        description != null ? description.toString() : null
      );
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onReceivedError(
      WebView view, int errorCode, String description, String failingUrl
    ) {
      super.onReceivedError(view, errorCode, description, failingUrl);
      // Fallback for API < 23 only. On current targets the modern callback
      // above is the entry point and never delegates here, so this path
      // cannot double-emit.
      // Legacy API cannot tell sub-resource failures apart, so only report
      // when the failing URL matches the page being loaded.
      String current = view.getUrl();
      if (failingUrl == null || !failingUrl.equals(current)) return;
      sendLoadError(failingUrl, errorCode, description);
    }

    private void sendLoadError(String url, int code, String description) {
      try {
        JSONObject data = new JSONObject();
        data.put("url", url != null ? url : "");
        data.put("code", code);
        data.put("description", description != null ? description : "");
        plugin.sendEventToCordova(id, "loadError", data);
      } catch (JSONException e) {
        Log.e(TAG, "onReceivedError error", e);
      }
    }
  }

  private class InstanceWebChromeClient extends WebChromeClient {
    @Override
    public void onProgressChanged(WebView view, int newProgress) {
      super.onProgressChanged(view, newProgress);
      try {
        JSONObject data = new JSONObject();
        data.put("progress", newProgress);
        plugin.sendEventToCordova(id, "progressChanged", data);
      } catch (JSONException e) {
        Log.e(TAG, "onProgressChanged error", e);
      }
    }

    @Override
    public void onReceivedTitle(WebView view, String pageTitle) {
      super.onReceivedTitle(view, pageTitle);
      try {
        JSONObject data = new JSONObject();
        data.put("title", pageTitle != null ? pageTitle : "");
        plugin.sendEventToCordova(id, "titleChanged", data);
      } catch (JSONException e) {
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
    public void onDownloadStart(final String url, final String userAgent, String contentDisposition, final String mimeType, long contentLength) {
      if (isDestroyed) return;
      if (context instanceof Activity && ((Activity) context).isFinishing()) return;

      // DownloadManager can only fetch http(s) URLs.
      String scheme = Uri.parse(url).getScheme();
      if (scheme == null
        || !(scheme.equalsIgnoreCase("http") || scheme.equalsIgnoreCase("https"))) {
        runOnUiThread(new Runnable() {
          @Override
          public void run() {
            Toast.makeText(context, "This download type is not supported", Toast.LENGTH_SHORT).show();
          }
        });
        return;
      }

      final String fileName = URLUtil.guessFileName(url, contentDisposition, mimeType);
      String size = formatSize(contentLength);
      final String message = size.isEmpty()
        ? "Do you want to download \"" + fileName + "\"?"
        : "Do you want to download \"" + fileName + "\" (" + size + ")?";

      runOnUiThread(new Runnable() {
        @Override
        public void run() {
          new AlertDialog.Builder(context)
            .setTitle("Download file")
            .setMessage(message)
            .setPositiveButton("Download", new DialogInterface.OnClickListener() {
              @Override
              public void onClick(DialogInterface dialog, int which) {
                plugin.download(url, userAgent, mimeType, fileName);
              }
            })
            .setNegativeButton("Cancel", null)
            .show();
        }
      });
    }
  }

  private static String formatSize(long bytes) {
    if (bytes <= 0) return "";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return String.format(Locale.US, "%.1f KB", bytes / 1024.0);
    if (bytes < 1024L * 1024 * 1024) return String.format(Locale.US, "%.1f MB", bytes / (1024.0 * 1024));
    return String.format(Locale.US, "%.1f GB", bytes / (1024.0 * 1024 * 1024));
  }

  public class JsBridge {
    @JavascriptInterface
    public void postMessage(String message) {
      plugin.sendMessageToCordova(id, message);
    }
  }
}

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
import android.os.SystemClock;
import android.util.Log;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.webkit.ConsoleMessage;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.SslErrorHandler;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import androidx.webkit.Profile;
import androidx.webkit.ScriptHandler;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.apache.cordova.CallbackContext;
import org.json.JSONException;
import org.json.JSONObject;
import org.json.JSONTokener;

/**
 * One managed WebView plus the page-side bridge and lifecycle events.
 *
 * <p>Instances are created by {@link WebViewPlugin} and can either be
 * "fullscreen" (hosted by a {@link WebViewActivity}) or "hidden" (headless).
 * Isolation is always on: file/content access is disabled and navigation is
 * restricted to http(s). Incognito additionally routes the WebView through a
 * private WebView profile when the provider supports it.
 */
public class WebViewInstance {

  private static final String TAG = "WebViewInstance";
  private static final String BRIDGE_NAME = "AcodeWebViewNative";

  private static final String EVENT_PAGE_STARTED = "pageStarted";
  private static final String EVENT_PAGE_FINISHED = "pageFinished";
  private static final String EVENT_PAGE_COMMIT_VISIBLE = "pageCommitVisible";
  private static final String EVENT_PROGRESS = "progressChanged";
  private static final String EVENT_TITLE_CHANGED = "titleChanged";
  private static final String EVENT_FAVICON_CHANGED = "faviconChanged";
  private static final String EVENT_HISTORY_CHANGED = "historyChanged";
  private static final String EVENT_SCROLL_CHANGED = "scrollChanged";
  private static final String EVENT_NAVIGATION_REQUESTED = "navigationRequested";
  private static final String EVENT_NAVIGATION_BLOCKED = "navigationBlocked";
  private static final String EVENT_RESOURCE_ERROR = "resourceError";
  private static final String EVENT_HTTP_ERROR = "httpError";
  private static final String EVENT_SSL_ERROR = "sslError";
  private static final String EVENT_CONSOLE_MESSAGE = "consoleMessage";
  private static final String EVENT_JS_ALERT = "jsAlert";
  private static final String EVENT_JS_CONFIRM = "jsConfirm";
  private static final String EVENT_JS_PROMPT = "jsPrompt";
  private static final String EVENT_JS_BEFORE_UNLOAD = "jsBeforeUnload";
  private static final String EVENT_PERMISSION_REQUEST = "permissionRequest";
  private static final String EVENT_GEOLOCATION_PERMISSION = "geolocationPermissionRequest";
  private static final String EVENT_FULLSCREEN_CHANGED = "fullscreenChanged";
  private static final String EVENT_WINDOW_REQUESTED = "windowRequested";
  private static final String EVENT_DOWNLOAD_REQUESTED = "downloadRequested";
  private static final String EVENT_DOWNLOAD_STARTED = "downloadStarted";
  private static final String EVENT_DOWNLOAD_FAILED = "downloadFailed";
  private static final String EVENT_RENDER_PROCESS_GONE = "renderProcessGone";
  private static final String EVENT_READY = "ready";

  private static final long SCROLL_EVENT_INTERVAL_MS = 80;

  /**
   * Page-side messaging bridge. Installed at document start when the provider
   * supports it, and re-injected on page started/finished as a fallback. It is
   * idempotent, so the guard keeps callbacks registered by the page intact
   * across injections.
   */
  private static final String BRIDGE_JS =
    "(function(){" +
    "if(window.webview&&window.webview.__acodeBridge){return;}" +
    "var callbacks=[];" +
    "window.webview={" +
    "__acodeBridge:true," +
    "platform:'android'," +
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
  final WebViewOptions options;
  final WebViewPlugin plugin;

  private WebView webView;
  private WebViewActivity hostingActivity = null;
  private boolean destroyed = false;

  /** Resolved WebView profile name, or null when isolation is unavailable. */
  private String profileName = null;
  private Profile profile = null;
  private boolean profileIsolated = false;
  private boolean ephemeralProfile = false;

  private String pendingUrl = null;
  private Map<String, String> pendingHeaders = null;
  private String pendingHtml = null;
  private JSONObject pendingHtmlOptions = null;

  private String currentUrl = "";
  private String currentTitle = "";
  private int progress = 0;
  private boolean loading = false;

  private View customView = null;
  private WebChromeClient.CustomViewCallback customViewCallback = null;
  private ScriptHandler documentStartScript = null;
  private long lastScrollEventAt = 0L;

  WebViewInstance(String id, WebViewOptions options, WebViewPlugin plugin) {
    this.id = id;
    this.options = options;
    this.plugin = plugin;
    // Acquire the profile up front so isolation metadata is final before the
    // (lazily created) fullscreen WebView exists.
    acquireProfile();
  }

  public WebView getWebView() {
    return webView;
  }

  String getTitle() {
    return options.title;
  }

  boolean isFullscreen() {
    return "fullscreen".equals(options.mode);
  }

  boolean isIncognito() {
    return options.incognito;
  }

  boolean isIsolated() {
    return profileIsolated;
  }

  /** Resolved WebView profile name, or null when no profile is in use. */
  String getProfileName() {
    return profileName;
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

  /**
   * Creates the native WebView. Idempotent: a recreated hosting activity reuses
   * the existing WebView (and its page state) instead of leaking a new one.
   */
  void createWebView(Activity activity) {
    if (webView != null) return;

    webView = new ScrollAwareWebView(activity);
    bindProfile();
    options.applyTo(webView, activity);
    configureClients(activity);
    installBridge();
    applyPendingContent();
    emit(EVENT_READY, data().put("mode", options.mode));
  }

  /** True once the native WebView exists and can accept evaluate(). */
  boolean isReady() {
    return webView != null && !destroyed;
  }

  /**
   * Resolves and acquires the WebView profile before any WebView exists. This
   * makes {@link #isIsolated()} and {@link #getProfileName()} final at creation
   * time, including for fullscreen instances whose WebView is created later.
   */
  private void acquireProfile() {
    String requested = options.profileName;
    boolean explicit = requested != null && !requested.trim().isEmpty();

    if (options.incognito) {
      profileName = explicit ? requested.trim() : ProfileManager.ephemeralName(id);
      ephemeralProfile = !explicit;
    } else if (explicit) {
      profileName = requested.trim();
      ephemeralProfile = false;
    }

    if (profileName == null) return;

    profile = ProfileManager.acquire(profileName);
    profileIsolated = profile != null;
    if (!profileIsolated) {
      // Multi-profile is unavailable on this provider. Fall back to
      // best-effort incognito (no cache) without pretending to be isolated.
      profileName = null;
      ephemeralProfile = false;
    }
  }

  /** Binds the acquired profile to the freshly constructed WebView. */
  private void bindProfile() {
    if (profile == null) return;
    if (ProfileManager.bind(webView, profile)) return;

    // Binding failed: drop the reference and fall back to the non-isolated
    // behaviour rather than leaking the profile.
    ProfileManager.release(profileName, ephemeralProfile, false);
    profile = null;
    profileName = null;
    ephemeralProfile = false;
    profileIsolated = false;
  }

  /**
   * Cookie manager backing this instance. Isolated profiles use their own jar
   * so downloads and other native requests never cross the profile boundary.
   */
  CookieManager getCookieManager() {
    try {
      if (profile != null) {
        CookieManager scoped = profile.getCookieManager();
        if (scoped != null) return scoped;
      }
    } catch (Throwable t) {
      Log.w(TAG, "Could not access profile cookie manager", t);
    }
    return CookieManager.getInstance();
  }

  private void configureClients(Activity activity) {
    webView.setWebViewClient(new InstanceWebViewClient());
    webView.setWebChromeClient(new InstanceWebChromeClient());
    webView.setFocusable(true);
    webView.setFocusableInTouchMode(true);
    webView.addJavascriptInterface(new JsBridge(), BRIDGE_NAME);

    if (options.allowDownloads) {
      webView.setDownloadListener(new InstanceDownloadListener(activity));
    }
  }

  private void installBridge() {
    try {
      if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
        documentStartScript = WebViewCompat.addDocumentStartJavaScript(
          webView,
          BRIDGE_JS,
          Collections.singleton("*")
        );
        if (documentStartScript != null) return;
      }
    } catch (Throwable t) {
      Log.w(TAG, "Document-start script unavailable; falling back to injection", t);
    }
    injectBridge(webView);
  }

  private static void injectBridge(WebView view) {
    view.evaluateJavascript(BRIDGE_JS, null);
  }

  private void applyPendingContent() {
    if (webView == null) return;
    if (pendingUrl != null) {
      String url = pendingUrl;
      Map<String, String> headers = pendingHeaders;
      clearPending();
      if (headers != null && !headers.isEmpty()) {
        webView.loadUrl(url, headers);
      } else {
        webView.loadUrl(url);
      }
    } else if (pendingHtml != null) {
      String html = pendingHtml;
      JSONObject htmlOptions = pendingHtmlOptions;
      clearPending();
      loadHtmlNow(html, htmlOptions);
    }
  }

  private void clearPending() {
    pendingUrl = null;
    pendingHeaders = null;
    pendingHtml = null;
    pendingHtmlOptions = null;
  }

  private void loadHtmlNow(String html, JSONObject htmlOptions) {
    String baseUrl = null;
    String mimeType = "text/html";
    String encoding = "UTF-8";
    String historyUrl = null;

    if (htmlOptions != null) {
      baseUrl = sanitizeUrl(optString(htmlOptions, "baseUrl"));
      mimeType = htmlOptions.optString("mimeType", mimeType);
      encoding = htmlOptions.optString("encoding", encoding);
      historyUrl = sanitizeUrl(optString(htmlOptions, "historyUrl"));
    }

    webView.loadDataWithBaseURL(baseUrl, html, mimeType, encoding, historyUrl);
  }

  // ---------------------------------------------------------------------------
  // Page actions
  // ---------------------------------------------------------------------------

  void loadURL(String url, JSONObject headers, final CallbackContext callbackContext) {
    if (rejectIfDestroyed(callbackContext)) return;

    final String safeUrl = sanitizeUrl(url);
    if (safeUrl == null) {
      callbackContext.error("Blocked URL: only http:// and https:// URLs are allowed");
      return;
    }

    final Map<String, String> headerMap = toStringMap(headers);

    if (webView == null) {
      pendingUrl = safeUrl;
      pendingHeaders = headerMap;
      pendingHtml = null;
      pendingHtmlOptions = null;
      callbackContext.success();
      return;
    }

    runOnUiThread(() -> {
      if (headerMap != null && !headerMap.isEmpty()) {
        webView.loadUrl(safeUrl, headerMap);
      } else {
        webView.loadUrl(safeUrl);
      }
      callbackContext.success();
    });
  }

  void loadHTML(String html, JSONObject htmlOptions, final CallbackContext callbackContext) {
    if (rejectIfDestroyed(callbackContext)) return;

    if (webView == null) {
      pendingHtml = html;
      pendingHtmlOptions = htmlOptions;
      pendingUrl = null;
      pendingHeaders = null;
      callbackContext.success();
      return;
    }

    runOnUiThread(() -> {
      loadHtmlNow(html, htmlOptions);
      callbackContext.success();
    });
  }

  void evaluate(String js, final CallbackContext callbackContext) {
    if (rejectIfDestroyed(callbackContext)) return;
    if (rejectIfNotReady(callbackContext)) return;

    runOnUiThread(() -> webView.evaluateJavascript(js, value ->
      callbackContext.success(decodeJsResult(value))
    ));
  }

  /**
   * evaluateJavascript() delivers the result as a JSON-encoded string. Decode
   * it properly instead of stripping quotes by hand so escapes (newlines,
   * unicode, quotes) survive the round trip.
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
    if (rejectIfDestroyed(callbackContext)) return;
    if (rejectIfNotReady(callbackContext)) return;

    // JSONObject.quote() produces a safe JS string literal for any input, so a
    // malicious or sloppy payload cannot break out of the string and inject
    // code into the page context. The page receives a parsed value for JSON
    // payloads and the raw string otherwise.
    final String js =
      "(function(){" +
      "var raw=" + JSONObject.quote(message) + ";" +
      "var msg;try{msg=JSON.parse(raw);}catch(e){msg=raw;}" +
      "if(window.webview&&window.webview._dispatch){window.webview._dispatch(msg);}" +
      "})();";

    runOnUiThread(() -> {
      webView.evaluateJavascript(js, null);
      callbackContext.success();
    });
  }

  void show(final CallbackContext callbackContext) {
    if (rejectIfDestroyed(callbackContext)) return;
    if (!isFullscreen()) {
      callbackContext.error(
        "Hidden WebViews cannot be shown; use mode \"fullscreen\" to display content"
      );
      return;
    }
    runOnUiThread(() -> plugin.showFullscreenActivity(id));
    callbackContext.success();
  }

  void hide(final CallbackContext callbackContext) {
    if (rejectIfDestroyed(callbackContext)) return;
    if (!isFullscreen()) {
      // A hidden (headless) WebView is already hidden.
      callbackContext.success();
      return;
    }
    hideFullscreen(callbackContext);
  }

  /**
   * Hiding a fullscreen WebView moves its hosting activity (and its task) to
   * the background. Nothing is destroyed, so show() brings the same WebView
   * back with its page state intact. The instance is only destroyed when the
   * user actually closes it (back button/task removal) or destroy() is called.
   */
  private void hideFullscreen(CallbackContext callbackContext) {
    runOnUiThread(() -> {
      if (hostingActivity != null
        && !hostingActivity.isFinishing()
        && !hostingActivity.isDestroyed()) {
        hostingActivity.moveTaskToBack(true);
      }
    });
    callbackContext.success();
  }

  void reload(final CallbackContext callbackContext) {
    if (rejectIfDestroyed(callbackContext)) return;
    if (rejectIfNotReady(callbackContext)) return;
    runOnUiThread(() -> {
      webView.reload();
      callbackContext.success();
    });
  }

  void stopLoading(final CallbackContext callbackContext) {
    if (rejectIfDestroyed(callbackContext)) return;
    if (rejectIfNotReady(callbackContext)) return;
    runOnUiThread(() -> {
      webView.stopLoading();
      callbackContext.success();
    });
  }

  void goBack(final CallbackContext callbackContext) {
    if (rejectIfDestroyed(callbackContext)) return;
    if (rejectIfNotReady(callbackContext)) return;
    runOnUiThread(() -> {
      boolean moved = webView.canGoBack();
      if (moved) webView.goBack();
      callbackContext.success(moved);
    });
  }

  void goForward(final CallbackContext callbackContext) {
    if (rejectIfDestroyed(callbackContext)) return;
    if (rejectIfNotReady(callbackContext)) return;
    runOnUiThread(() -> {
      boolean moved = webView.canGoForward();
      if (moved) webView.goForward();
      callbackContext.success(moved);
    });
  }

  void canGoBack(final CallbackContext callbackContext) {
    if (rejectIfDestroyed(callbackContext)) return;
    if (rejectIfNotReady(callbackContext)) return;
    runOnUiThread(() -> callbackContext.success(webView.canGoBack()));
  }

  void canGoForward(final CallbackContext callbackContext) {
    if (rejectIfDestroyed(callbackContext)) return;
    if (rejectIfNotReady(callbackContext)) return;
    runOnUiThread(() -> callbackContext.success(webView.canGoForward()));
  }

  void clearCache(final boolean includeDiskFiles, final CallbackContext callbackContext) {
    if (rejectIfDestroyed(callbackContext)) return;
    if (rejectIfNotReady(callbackContext)) return;
    runOnUiThread(() -> {
      webView.clearCache(includeDiskFiles);
      callbackContext.success();
    });
  }

  void clearHistory(final CallbackContext callbackContext) {
    if (rejectIfDestroyed(callbackContext)) return;
    if (rejectIfNotReady(callbackContext)) return;
    runOnUiThread(() -> {
      webView.clearHistory();
      callbackContext.success();
    });
  }

  void clearFormData(final CallbackContext callbackContext) {
    if (rejectIfDestroyed(callbackContext)) return;
    if (rejectIfNotReady(callbackContext)) return;
    runOnUiThread(() -> {
      webView.clearFormData();
      callbackContext.success();
    });
  }

  void setUserAgent(final String userAgent, final String mode, final CallbackContext callbackContext) {
    if (rejectIfDestroyed(callbackContext)) return;

    final JSONObject partial = new JSONObject();
    try {
      partial.put("userAgent", userAgent != null ? userAgent : JSONObject.NULL);
      if (mode != null && !mode.isEmpty()) {
        partial.put("userAgentMode", mode);
      }
    } catch (JSONException e) {
      callbackContext.error(e.getMessage());
      return;
    }

    applySettings(partial, callbackContext);
  }

  void getUserAgent(final CallbackContext callbackContext) {
    if (rejectIfDestroyed(callbackContext)) return;
    runOnUiThread(() -> {
      if (destroyed) {
        callbackContext.error("WebView has been destroyed");
        return;
      }
      if (webView == null) {
        // The WebView has not been created yet (fullscreen not shown); report
        // the configured value instead of failing.
        callbackContext.success(optString(options.settings(), "userAgent"));
        return;
      }
      callbackContext.success(webView.getSettings().getUserAgentString());
    });
  }

  void updateSettings(final JSONObject partial, final CallbackContext callbackContext) {
    if (rejectIfDestroyed(callbackContext)) return;
    applySettings(partial, callbackContext);
  }

  /**
   * Applies a settings batch on the UI thread — WebSettings and WebView methods
   * must be touched there — and completes the callback once it is applied.
   */
  private void applySettings(final JSONObject partial, final CallbackContext callbackContext) {
    runOnUiThread(() -> {
      if (destroyed) {
        callbackContext.error("WebView has been destroyed");
        return;
      }
      try {
        JSONObject settings = options.update(webView, appContext(), partial);
        callbackContext.success(settings);
      } catch (Exception e) {
        callbackContext.error(e.getMessage());
      }
    });
  }

  void getSettings(final CallbackContext callbackContext) {
    if (rejectIfDestroyed(callbackContext)) return;
    runOnUiThread(() -> {
      if (destroyed) {
        callbackContext.error("WebView has been destroyed");
        return;
      }
      callbackContext.success(options.settings());
    });
  }

  void getInfo(final CallbackContext callbackContext) {
    try {
      final JSONObject info = new JSONObject();
      info.put("id", id);
      info.put("mode", options.mode);
      info.put("incognito", options.incognito);
      info.put("isolated", profileIsolated);
      info.put("destroyed", destroyed);
      info.put("ready", isReady());
      if (profileName != null) {
        info.put("profileName", profileName);
      }
      info.put("url", currentUrl);
      info.put("title", currentTitle);
      info.put("progress", progress);
      info.put("loading", loading);
      info.put("canGoBack", false);
      info.put("canGoForward", false);
      info.put("userAgent", optString(options.settings(), "userAgent"));

      if (destroyed || webView == null) {
        callbackContext.success(info);
        return;
      }

      runOnUiThread(() -> {
        try {
          String url = webView.getUrl();
          if (url != null) currentUrl = url;
          String pageTitle = webView.getTitle();
          if (pageTitle != null) currentTitle = pageTitle;
          info.put("url", currentUrl);
          info.put("title", currentTitle);
          info.put("canGoBack", webView.canGoBack());
          info.put("canGoForward", webView.canGoForward());
          info.put("userAgent", webView.getSettings().getUserAgentString());
        } catch (JSONException e) {
          Log.w(TAG, "Could not build full WebView info", e);
        }
        callbackContext.success(info);
      });
    } catch (JSONException e) {
      callbackContext.error(e.getMessage());
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  void destroy() {
    if (destroyed) return;
    destroyed = true;

    // Finish the hosting fullscreen activity, if any. Its onDestroy() calls
    // destroy() again, which is a no-op now that destroyed is set.
    WebViewActivity hosting = hostingActivity;
    hostingActivity = null;
    if (hosting != null && !hosting.isFinishing()) {
      hosting.finish();
    }

    runOnUiThread(() -> {
      exitCustomView();

      if (documentStartScript != null) {
        try {
          documentStartScript.remove();
        } catch (Throwable t) {
          Log.w(TAG, "Could not remove document-start script", t);
        }
        documentStartScript = null;
      }

      if (webView != null) {
        // On providers without multi-profile support, incognito can at least
        // drop the shared HTTP cache and saved form data.
        if (options.incognito && !profileIsolated) {
          try {
            webView.clearCache(true);
            webView.clearFormData();
          } catch (Throwable t) {
            Log.w(TAG, "Fallback incognito cleanup failed", t);
          }
        }
        try {
          if (webView.getParent() != null) {
            ((ViewGroup) webView.getParent()).removeView(webView);
          }
        } catch (Throwable ignored) {}
        try {
          webView.removeJavascriptInterface(BRIDGE_NAME);
          webView.setDownloadListener(null);
          webView.setWebChromeClient(null);
          webView.setWebViewClient(null);
          webView.stopLoading();
          webView.loadUrl("about:blank");
          webView.destroy();
        } catch (Throwable t) {
          Log.w(TAG, "Error destroying WebView", t);
        }
      }
      webView = null;

      if (profileName != null) {
        ProfileManager.release(profileName, ephemeralProfile, options.incognito);
        profileName = null;
      }
      profile = null;
      profileIsolated = false;
    });
  }

  private void onPageFinished(WebView view) {
    // Navigation replaced the page's JS context, so re-inject (no-op when the
    // document-start script is already installed).
    injectBridge(view);
    String url = view.getUrl();
    currentUrl = url != null ? url : "";
    String pageTitle = view.getTitle();
    currentTitle = pageTitle != null ? pageTitle : "";
    loading = false;
    emit(EVENT_PAGE_FINISHED, data()
      .put("url", currentUrl)
      .put("title", currentTitle));
  }

  private void onPageStarted(String url) {
    currentUrl = url != null ? url : "";
    loading = true;
    emit(EVENT_PAGE_STARTED, data().put("url", currentUrl));
  }

  private void onScrollChanged(int x, int y, int oldX, int oldY) {
    long now = SystemClock.uptimeMillis();
    if (now - lastScrollEventAt < SCROLL_EVENT_INTERVAL_MS) return;
    lastScrollEventAt = now;
    emit(EVENT_SCROLL_CHANGED, data()
      .put("scrollX", x)
      .put("scrollY", y)
      .put("oldScrollX", oldX)
      .put("oldScrollY", oldY));
  }

  // ---------------------------------------------------------------------------
  // Fullscreen custom views (video, canvas, …)
  // ---------------------------------------------------------------------------

  void onShowCustomView(View view, WebChromeClient.CustomViewCallback callback) {
    if (customView != null) {
      callback.onCustomViewHidden();
      return;
    }
    customView = view;
    customViewCallback = callback;

    WebViewActivity hosting = hostingActivity;
    if (hosting == null || hosting.isFinishing()) {
      // Headless instance: there is nowhere to render the view. Release it so
      // the page is not left waiting.
      exitCustomView();
      emit(EVENT_FULLSCREEN_CHANGED, data().put("fullscreen", true).put("supported", false));
      return;
    }

    hosting.showCustomView(view);
    emit(EVENT_FULLSCREEN_CHANGED, data().put("fullscreen", true).put("supported", true));
  }

  void onHideCustomView() {
    if (customView == null) return;
    exitCustomView();
    emit(EVENT_FULLSCREEN_CHANGED, data().put("fullscreen", false));
  }

  boolean isInCustomView() {
    return customView != null;
  }

  void exitCustomView() {
    WebViewActivity hosting = hostingActivity;
    if (hosting != null && !hosting.isFinishing()) {
      hosting.hideCustomView();
    }
    WebChromeClient.CustomViewCallback callback = customViewCallback;
    customView = null;
    customViewCallback = null;
    if (callback != null) {
      try {
        callback.onCustomViewHidden();
      } catch (Throwable ignored) {}
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private boolean rejectIfDestroyed(CallbackContext callbackContext) {
    if (!destroyed) return false;
    callbackContext.error("WebView has been destroyed");
    return true;
  }

  private boolean rejectIfNotReady(CallbackContext callbackContext) {
    if (webView != null) return false;
    callbackContext.error("WebView is not ready");
    return true;
  }

  private Context appContext() {
    WebViewActivity hosting = hostingActivity;
    if (hosting != null) return hosting;
    WebView view = webView;
    if (view != null) return view.getContext();
    return plugin.getContext();
  }

  private void emit(String event, Payload data) {
    plugin.sendEventToCordova(id, event, data.json);
  }

  private static Payload data() {
    return new Payload();
  }

  /**
   * Tiny fluent builder for event payloads. org.json's put() throws a checked
   * exception; swallowing it here keeps the many event call sites readable.
   */
  private static final class Payload {
    final JSONObject json = new JSONObject();

    Payload put(String key, Object value) {
      try {
        json.put(key, value);
      } catch (JSONException e) {
        Log.w(TAG, "Could not add \"" + key + "\" to event payload", e);
      }
      return this;
    }
  }

  void download(String url, String userAgent, String mimeType, String fileName) {
    // Pass this instance so the download uses its profile-scoped cookie jar.
    boolean started = plugin.download(this, url, userAgent, mimeType, fileName);
    if (started) {
      emit(EVENT_DOWNLOAD_STARTED, data()
        .put("url", url)
        .put("fileName", fileName)
        .put("mimeType", mimeType));
    } else {
      emit(EVENT_DOWNLOAD_FAILED, data().put("url", url).put("fileName", fileName));
    }
  }

  private static void runOnUiThread(Runnable runnable) {
    new Handler(Looper.getMainLooper()).post(runnable);
  }

  private static Map<String, String> toStringMap(JSONObject object) {
    if (object == null || object.length() == 0) return null;
    Map<String, String> map = new HashMap<>();
    java.util.Iterator<String> keys = object.keys();
    while (keys.hasNext()) {
      String key = keys.next();
      Object value = object.opt(key);
      if (value != null && value != JSONObject.NULL) {
        map.put(key, String.valueOf(value));
      }
    }
    return map.isEmpty() ? null : map;
  }

  private static String optString(JSONObject object, String key) {
    if (object == null || !object.has(key) || object.isNull(key)) return null;
    return object.optString(key, null);
  }

  private static final Pattern SCHEME_PATTERN =
    Pattern.compile("^([a-zA-Z][a-zA-Z0-9+\\-.]*)://");

  /**
   * Allows only http and https URLs, so hosted pages can never reach local
   * files, app content providers or execute javascript: URLs. Input without a
   * "scheme://" prefix ("example.com", "localhost:8080/page") is treated as a
   * host and loaded over https; anything that is not clearly a URL degrades
   * into a harmless failed https load.
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

  // ---------------------------------------------------------------------------
  // Native WebView / client implementations
  // ---------------------------------------------------------------------------

  /** Emits throttled scroll events; WebView does not expose a scroll listener. */
  private class ScrollAwareWebView extends WebView {
    ScrollAwareWebView(Context context) {
      super(context);
    }

    @Override
    protected void onScrollChanged(int l, int t, int oldl, int oldt) {
      super.onScrollChanged(l, t, oldl, oldt);
      WebViewInstance.this.onScrollChanged(l, t, oldl, oldt);
    }
  }

  private class InstanceWebViewClient extends WebViewClient {

    @Override
    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
      return handleNavigation(request.getUrl());
    }

    @SuppressWarnings("deprecation")
    @Override
    public boolean shouldOverrideUrlLoading(WebView view, String url) {
      return handleNavigation(Uri.parse(url));
    }

    /**
     * Blocks all navigation when allowNavigation is false. Even when it is
     * true, only http(s) targets may load inside the WebView; other schemes
     * (file:, content:, intent:, javascript:, tel:, ...) are blocked so hostile
     * pages cannot escape the sandbox or launch other apps. Every decision is
     * announced through navigationRequested/navigationBlocked.
     */
    private boolean handleNavigation(Uri uri) {
      String url = uri != null ? uri.toString() : "";
      String scheme = uri != null ? uri.getScheme() : null;
      boolean httpScheme = scheme != null
        && (scheme.equalsIgnoreCase("http") || scheme.equalsIgnoreCase("https"));
      boolean allowed = options.allowNavigation && httpScheme;

      emit(EVENT_NAVIGATION_REQUESTED, data().put("url", url).put("allowed", allowed));

      if (!allowed) {
        String reason = !options.allowNavigation ? "navigation-disabled" : "unsupported-scheme";
        emit(EVENT_NAVIGATION_BLOCKED, data().put("url", url).put("reason", reason));
      }
      return !allowed;
    }

    @Override
    public void onPageStarted(WebView view, String url, Bitmap favicon) {
      super.onPageStarted(view, url, favicon);
      // Best effort fallback: gets the bridge in before the page's scripts run
      // on providers without document-start script support.
      injectBridge(view);
      WebViewInstance.this.onPageStarted(url);
    }

    @Override
    public void onPageFinished(WebView view, String url) {
      super.onPageFinished(view, url);
      WebViewInstance.this.onPageFinished(view);
    }

    @Override
    public void onPageCommitVisible(WebView view, String url) {
      super.onPageCommitVisible(view, url);
      if (url != null) currentUrl = url;
      emit(EVENT_PAGE_COMMIT_VISIBLE, data().put("url", url != null ? url : ""));
    }

    @Override
    public void onReceivedError(
      WebView view,
      WebResourceRequest request,
      WebResourceError error
    ) {
      super.onReceivedError(view, request, error);
      emit(EVENT_RESOURCE_ERROR, data()
        .put("url", request.getUrl() != null ? request.getUrl().toString() : "")
        .put("errorCode", error.getErrorCode())
        .put("description", String.valueOf(error.getDescription()))
        .put("isForMainFrame", request.isForMainFrame()));
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onReceivedError(
      WebView view,
      int errorCode,
      String description,
      String failingUrl
    ) {
      super.onReceivedError(view, errorCode, description, failingUrl);
      emit(EVENT_RESOURCE_ERROR, data()
        .put("url", failingUrl != null ? failingUrl : "")
        .put("errorCode", errorCode)
        .put("description", description != null ? description : "")
        .put("isForMainFrame", true));
    }

    @Override
    public void onReceivedHttpError(
      WebView view,
      WebResourceRequest request,
      WebResourceResponse errorResponse
    ) {
      super.onReceivedHttpError(view, request, errorResponse);
      emit(EVENT_HTTP_ERROR, data()
        .put("url", request.getUrl() != null ? request.getUrl().toString() : "")
        .put("statusCode", errorResponse.getStatusCode())
        .put("reasonPhrase", errorResponse.getReasonPhrase() != null
          ? errorResponse.getReasonPhrase() : "")
        .put("isForMainFrame", request.isForMainFrame()));
    }

    @Override
    public void onReceivedSslError(WebView view, SslErrorHandler handler, android.net.http.SslError error) {
      emit(EVENT_SSL_ERROR, data()
        .put("url", error.getUrl() != null ? error.getUrl() : "")
        .put("primaryError", error.getPrimaryError())
        .put("description", String.valueOf(error)));
      // Never proceed past a certificate error.
      handler.cancel();
    }

    @Override
    public void doUpdateVisitedHistory(WebView view, String url, boolean isReload) {
      super.doUpdateVisitedHistory(view, url, isReload);
      emit(EVENT_HISTORY_CHANGED, data()
        .put("url", url != null ? url : "")
        .put("isReload", isReload)
        .put("canGoBack", view.canGoBack())
        .put("canGoForward", view.canGoForward()));
    }

    @Override
    public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
      boolean didCrash = detail != null && detail.didCrash();
      emit(EVENT_RENDER_PROCESS_GONE, data().put("didCrash", didCrash));
      // The WebView can no longer be used; tear the instance down.
      plugin.removeInstance(id);
      destroy();
      return true;
    }
  }

  private class InstanceWebChromeClient extends WebChromeClient {

    @Override
    public void onProgressChanged(WebView view, int newProgress) {
      super.onProgressChanged(view, newProgress);
      progress = newProgress;
      loading = newProgress < 100;
      emit(EVENT_PROGRESS, data().put("progress", newProgress).put("url", currentUrl));
    }

    @Override
    public void onReceivedTitle(WebView view, String pageTitle) {
      super.onReceivedTitle(view, pageTitle);
      currentTitle = pageTitle != null ? pageTitle : "";
      emit(EVENT_TITLE_CHANGED, data().put("title", currentTitle));
    }

    @Override
    public void onReceivedIcon(WebView view, Bitmap icon) {
      super.onReceivedIcon(view, icon);
      Payload payload = data().put("url", currentUrl);
      if (icon != null) {
        payload.put("width", icon.getWidth());
        payload.put("height", icon.getHeight());
      }
      emit(EVENT_FAVICON_CHANGED, payload);
    }

    @Override
    public boolean onConsoleMessage(ConsoleMessage consoleMessage) {
      emit(EVENT_CONSOLE_MESSAGE, data()
        .put("message", consoleMessage.message() != null ? consoleMessage.message() : "")
        .put("level", consoleLevel(consoleMessage.messageLevel()))
        .put("sourceId", consoleMessage.sourceId() != null ? consoleMessage.sourceId() : "")
        .put("lineNumber", consoleMessage.lineNumber()));
      return false;
    }

    @Override
    public boolean onJsAlert(WebView view, String url, String message, android.webkit.JsResult result) {
      emit(EVENT_JS_ALERT, data().put("url", url).put("message", message));
      return false; // Let the WebView show its default dialog.
    }

    @Override
    public boolean onJsConfirm(WebView view, String url, String message, android.webkit.JsResult result) {
      emit(EVENT_JS_CONFIRM, data().put("url", url).put("message", message));
      return false;
    }

    @Override
    public boolean onJsPrompt(
      WebView view,
      String url,
      String message,
      String defaultValue,
      android.webkit.JsPromptResult result
    ) {
      emit(EVENT_JS_PROMPT, data()
        .put("url", url)
        .put("message", message)
        .put("defaultValue", defaultValue != null ? defaultValue : ""));
      return false;
    }

    @Override
    public boolean onJsBeforeUnload(
      WebView view,
      String url,
      String message,
      android.webkit.JsResult result
    ) {
      emit(EVENT_JS_BEFORE_UNLOAD, data().put("url", url).put("message", message));
      return false;
    }

    @Override
    public void onPermissionRequest(final PermissionRequest request) {
      Payload payload = data();
      payload.put("origin", request.getOrigin() != null ? request.getOrigin().toString() : "");
      payload.put(
        "resources",
        new org.json.JSONArray(java.util.Arrays.asList(request.getResources()))
      );
      emit(EVENT_PERMISSION_REQUEST, payload);
      // Deny by default: hosted content never gets camera/mic/etc. implicitly.
      request.deny();
    }

    @Override
    public void onGeolocationPermissionsShowPrompt(
      String origin,
      GeolocationPermissions.Callback callback
    ) {
      emit(EVENT_GEOLOCATION_PERMISSION, data().put("origin", origin != null ? origin : ""));
      boolean allow = options.settings().optBoolean("geolocation", false);
      callback.invoke(origin, allow, false);
    }

    @Override
    public void onShowCustomView(View view, CustomViewCallback callback) {
      WebViewInstance.this.onShowCustomView(view, callback);
    }

    @Override
    public void onHideCustomView() {
      WebViewInstance.this.onHideCustomView();
    }

    @Override
    public boolean onCreateWindow(
      WebView view,
      boolean isDialog,
      boolean isUserGesture,
      android.os.Message resultMsg
    ) {
      // Popups are not supported; announce and let the page keep running.
      emit(EVENT_WINDOW_REQUESTED, data().put("url", view.getUrl() != null ? view.getUrl() : ""));
      return false;
    }
  }

  private static String consoleLevel(ConsoleMessage.MessageLevel level) {
    if (level == null) return "log";
    switch (level) {
      case TIP:
        return "tip";
      case LOG:
        return "log";
      case WARNING:
        return "warning";
      case ERROR:
        return "error";
      case DEBUG:
        return "debug";
      default:
        return "log";
    }
  }

  private class InstanceDownloadListener implements DownloadListener {
    private final Context context;

    InstanceDownloadListener(Context context) {
      this.context = context;
    }

    @Override
    public void onDownloadStart(
      final String url,
      final String userAgent,
      String contentDisposition,
      final String mimeType,
      long contentLength
    ) {
      if (destroyed) return;
      if (context instanceof Activity && ((Activity) context).isFinishing()) return;

      // DownloadManager can only fetch http(s) URLs.
      String scheme = Uri.parse(url).getScheme();
      if (scheme == null
        || !(scheme.equalsIgnoreCase("http") || scheme.equalsIgnoreCase("https"))) {
        runOnUiThread(() -> Toast.makeText(
          context,
          "This download type is not supported",
          Toast.LENGTH_SHORT
        ).show());
        return;
      }

      final String fileName = URLUtil.guessFileName(url, contentDisposition, mimeType);
      String size = formatSize(contentLength);

      emit(EVENT_DOWNLOAD_REQUESTED, data()
        .put("url", url)
        .put("fileName", fileName)
        .put("mimeType", mimeType != null ? mimeType : "")
        .put("contentLength", contentLength)
        .put("userAgent", userAgent != null ? userAgent : "")
        .put("contentDisposition", contentDisposition != null ? contentDisposition : ""));

      final String message = size.isEmpty()
        ? "Do you want to download \"" + fileName + "\"?"
        : "Do you want to download \"" + fileName + "\" (" + size + ")?";

      runOnUiThread(() -> new AlertDialog.Builder(context)
        .setTitle("Download file")
        .setMessage(message)
        .setPositiveButton("Download", new DialogInterface.OnClickListener() {
          @Override
          public void onClick(DialogInterface dialog, int which) {
            WebViewInstance.this.download(url, userAgent, mimeType, fileName);
          }
        })
        .setNegativeButton("Cancel", null)
        .show());
    }
  }

  private static String formatSize(long bytes) {
    if (bytes <= 0) return "";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return String.format(Locale.US, "%.1f KB", bytes / 1024.0);
    if (bytes < 1024L * 1024 * 1024) {
      return String.format(Locale.US, "%.1f MB", bytes / (1024.0 * 1024));
    }
    return String.format(Locale.US, "%.1f GB", bytes / (1024.0 * 1024 * 1024));
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

  public class JsBridge {
    @JavascriptInterface
    public void postMessage(String message) {
      plugin.sendMessageToCordova(id, message);
    }
  }
}

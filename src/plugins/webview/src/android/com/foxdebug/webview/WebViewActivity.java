package com.foxdebug.webview;

import android.app.Activity;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

public class WebViewActivity extends Activity {

  private static WebViewPlugin plugin;

  private WebView webView;
  private String webviewId;
  private boolean allowNavigation;

  public static void setPlugin(WebViewPlugin p) {
    plugin = p;
  }

  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);

    Intent intent = getIntent();
    webviewId = intent.getStringExtra("webviewId");
    allowNavigation = intent.getBooleanExtra("allowNavigation", true);

    WebViewInstance instance = plugin != null ? plugin.getInstance(webviewId) : null;

    if (instance != null && instance.getWebView() == null) {
      instance.createWebView(this);
      webView = instance.getWebView();
    } else if (instance != null) {
      webView = instance.getWebView();
    } else {
      webView = new WebView(this);
      webView.addJavascriptInterface(new JsBridge(), "AcodeWebViewNative");

      WebSettings settings = webView.getSettings();
      settings.setJavaScriptEnabled(true);
      settings.setDomStorageEnabled(true);
      settings.setAllowContentAccess(true);
      settings.setDisplayZoomControls(false);
      settings.setLoadWithOverviewMode(true);
      settings.setUseWideViewPort(true);
      settings.setAllowFileAccess(true);

      webView.setWebViewClient(new FullscreenWebViewClient());

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

    FrameLayout container = new FrameLayout(this);
    container.addView(webView, new FrameLayout.LayoutParams(
      ViewGroup.LayoutParams.MATCH_PARENT,
      ViewGroup.LayoutParams.MATCH_PARENT
    ));
    setContentView(container);

    if (Build.VERSION.SDK_INT >= 30) {
      getWindow().setDecorFitsSystemWindows(false);
    }
  }

  @Override
  public void onBackPressed() {
    if (webView != null && webView.canGoBack()) {
      webView.goBack();
    } else {
      finish();
    }
  }

  @Override
  protected void onDestroy() {
    super.onDestroy();
    if (plugin != null) {
      plugin.sendEventToCordova(webviewId, "closed", null);
    }
  }

  private class FullscreenWebViewClient extends WebViewClient {
    @Override
    public boolean shouldOverrideUrlLoading(WebView view, android.webkit.WebResourceRequest request) {
      return !allowNavigation;
    }
  }

  private class JsBridge {
    @JavascriptInterface
    public void postMessage(String message) {
      if (plugin != null) {
        plugin.sendMessageToCordova(webviewId, message);
      }
    }

    @JavascriptInterface
    public String getWebViewId() {
      return webviewId;
    }
  }
}

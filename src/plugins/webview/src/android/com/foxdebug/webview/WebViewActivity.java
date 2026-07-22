package com.foxdebug.webview;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Insets;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.graphics.drawable.GradientDrawable;

public class WebViewActivity extends Activity {

  private static final String TAG = "WebViewActivity";
  private static WebViewPlugin plugin;

  private WebView webView;
  private String webviewId;
  private String title;
  private boolean allowNavigation;
  private boolean allowDownloads;

  public static void setPlugin(WebViewPlugin p) {
    plugin = p;
  }

  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);

    Intent intent = getIntent();
    webviewId = intent.getStringExtra("webviewId");
    title = intent.getStringExtra("title");
    allowNavigation = intent.getBooleanExtra("allowNavigation", true);
    allowDownloads = intent.getBooleanExtra("allowDownloads", false);

    LinearLayout layout = new LinearLayout(this);
    layout.setOrientation(LinearLayout.VERTICAL);
    layout.setLayoutParams(new LinearLayout.LayoutParams(
      ViewGroup.LayoutParams.MATCH_PARENT,
      ViewGroup.LayoutParams.MATCH_PARENT
    ));

    TextView titleBar = new TextView(this);
    titleBar.setText(title != null ? title : "WebView");
    titleBar.setTextColor(Color.WHITE);
    titleBar.setPadding(dpToPx(16), dpToPx(8), dpToPx(16), dpToPx(8));
    titleBar.setTextSize(16);
    titleBar.setBackgroundColor(Color.argb(255, 33, 33, 33));

    GradientDrawable closeBg = new GradientDrawable();
    closeBg.setColor(Color.argb(255, 80, 80, 80));
    closeBg.setCornerRadius(dpToPx(4));

    TextView closeButton = new TextView(this);
    closeButton.setText("✕");
    closeButton.setTextColor(Color.WHITE);
    closeButton.setTextSize(18);
    closeButton.setPadding(dpToPx(12), dpToPx(4), dpToPx(12), dpToPx(4));
    closeButton.setBackground(closeBg);
    closeButton.setOnClickListener(new View.OnClickListener() {
      @Override
      public void onClick(View v) {
        finish();
      }
    });

    LinearLayout titleLayout = new LinearLayout(this);
    titleLayout.setOrientation(LinearLayout.HORIZONTAL);
    titleLayout.setBackgroundColor(Color.argb(255, 33, 33, 33));
    titleLayout.setPadding(dpToPx(12), 0, dpToPx(12), 0);

    LinearLayout.LayoutParams titleParams = new LinearLayout.LayoutParams(
      0, ViewGroup.LayoutParams.WRAP_CONTENT, 1
    );
    titleLayout.addView(titleBar, titleParams);
    titleLayout.addView(closeButton, new LinearLayout.LayoutParams(
      ViewGroup.LayoutParams.WRAP_CONTENT,
      ViewGroup.LayoutParams.WRAP_CONTENT
    ));

    webView = new WebView(this);
    webView.setWebViewClient(new FullscreenWebViewClient());
    webView.addJavascriptInterface(new JsBridge(), "AcodeWebViewNative");

    WebSettings settings = webView.getSettings();
    settings.setJavaScriptEnabled(true);
    settings.setDomStorageEnabled(true);
    settings.setAllowContentAccess(true);
    settings.setDisplayZoomControls(false);
    settings.setLoadWithOverviewMode(true);
    settings.setUseWideViewPort(true);
    settings.setAllowFileAccess(true);

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

    FrameLayout webViewContainer = new FrameLayout(this);
    webViewContainer.setBackgroundColor(Color.WHITE);
    webViewContainer.addView(webView, new FrameLayout.LayoutParams(
      ViewGroup.LayoutParams.MATCH_PARENT,
      ViewGroup.LayoutParams.MATCH_PARENT
    ));

    layout.addView(titleLayout);
    layout.addView(webViewContainer, new LinearLayout.LayoutParams(
      ViewGroup.LayoutParams.MATCH_PARENT,
      0, 1
    ));

    setContentView(layout);

    if (Build.VERSION.SDK_INT >= 30) {
      getWindow().setDecorFitsSystemWindows(false);
    }

    WebViewInstance instance = plugin != null ? plugin.getInstance(webviewId) : null;
    if (instance != null) {
      instance.createWebView(this);
      webView = instance.getWebView();
      webViewContainer.removeAllViews();
      webViewContainer.addView(webView, new FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.MATCH_PARENT
      ));
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

  private int dpToPx(int dp) {
    return (int) (dp * getResources().getDisplayMetrics().density);
  }

  private class FullscreenWebViewClient extends WebViewClient {
    @Override
    public boolean shouldOverrideUrlLoading(WebView view, android.webkit.WebResourceRequest request) {
      if (!allowNavigation) {
        return true;
      }
      return false;
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

package com.foxdebug.webview;

import android.app.Activity;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.view.ViewGroup;
import android.webkit.WebView;
import android.widget.FrameLayout;

public class WebViewActivity extends Activity {

  private static WebViewPlugin plugin;

  private WebView webView;
  private String webviewId;

  public static void setPlugin(WebViewPlugin p) {
    plugin = p;
  }

  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);

    Intent intent = getIntent();
    webviewId = intent.getStringExtra("webviewId");

    WebViewInstance instance = plugin != null ? plugin.getInstance(webviewId) : null;
    if (instance == null) {
      finish();
      return;
    }

    instance.createWebView(this);
    webView = instance.getWebView();

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
      plugin.removeInstance(webviewId);
    }
  }
}

package com.foxdebug.webview;

import android.app.Activity;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import android.widget.FrameLayout;

/**
 * Hosts a "fullscreen" {@link WebViewInstance}: it shows the instance's WebView
 * and renders fullscreen custom views (video, canvas, …) on top of it.
 */
public class WebViewActivity extends Activity {

  private WebView webView;
  private String webviewId;
  private FrameLayout container;
  private View customView;

  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);

    webviewId = getIntent().getStringExtra("webviewId");

    // The plugin registers itself in pluginInitialize(), so the singleton is
    // always available while the app is alive.
    WebViewPlugin plugin = WebViewPlugin.getInstance();
    WebViewInstance instance = plugin != null ? plugin.getInstance(webviewId) : null;
    if (instance == null) {
      finish();
      return;
    }

    instance.createWebView(this);
    webView = instance.getWebView();
    if (webView == null) {
      finish();
      return;
    }
    instance.setHostingActivity(this);

    String title = instance.getTitle();
    if (title != null && !title.isEmpty()) {
      setTitle(title);
    }

    if (webView.getParent() != null) {
      ((ViewGroup) webView.getParent()).removeView(webView);
    }
    container = new FrameLayout(this);
    // Edge-to-edge is enforced on newer Android versions, so pad the content
    // out from under the status and navigation bars.
    WebViewInstance.applySystemBarInsets(container);
    container.addView(webView, new FrameLayout.LayoutParams(
      ViewGroup.LayoutParams.MATCH_PARENT,
      ViewGroup.LayoutParams.MATCH_PARENT
    ));
    setContentView(container);

    if (Build.VERSION.SDK_INT >= 30) {
      getWindow().setDecorFitsSystemWindows(false);
    }
  }

  /** Renders a fullscreen custom view (e.g. a <video>) over the WebView. */
  void showCustomView(View view) {
    if (view == null || container == null) return;
    if (customView != null) {
      hideCustomView();
    }
    customView = view;
    if (customView.getParent() instanceof ViewGroup) {
      ((ViewGroup) customView.getParent()).removeView(customView);
    }
    container.addView(customView, new FrameLayout.LayoutParams(
      ViewGroup.LayoutParams.MATCH_PARENT,
      ViewGroup.LayoutParams.MATCH_PARENT
    ));
    if (webView != null) {
      webView.setVisibility(View.GONE);
    }
  }

  /** Removes the fullscreen custom view and restores the WebView. */
  void hideCustomView() {
    if (customView != null) {
      if (customView.getParent() instanceof ViewGroup) {
        ((ViewGroup) customView.getParent()).removeView(customView);
      }
      customView = null;
    }
    if (webView != null) {
      webView.setVisibility(View.VISIBLE);
    }
  }

  @Override
  public void onBackPressed() {
    // Fullscreen custom views consume the first back press.
    WebViewPlugin plugin = WebViewPlugin.getInstance();
    WebViewInstance instance = plugin != null ? plugin.getInstance(webviewId) : null;
    if (instance != null && instance.isInCustomView()) {
      instance.onHideCustomView();
      return;
    }

    if (webView != null && webView.canGoBack()) {
      webView.goBack();
    } else {
      finish();
    }
  }

  @Override
  protected void onDestroy() {
    super.onDestroy();

    hideCustomView();

    WebViewPlugin plugin = WebViewPlugin.getInstance();
    if (plugin != null && webviewId != null) {
      WebViewInstance instance = plugin.getInstance(webviewId);
      if (instance != null) {
        instance.clearHostingActivity(this);
        // Actually destroy the WebView instead of leaking it, then drop the
        // instance so later calls fail instead of touching a dead WebView.
        // destroy() is idempotent, so this is safe when the JS side already
        // called destroy() and finishing this activity is what tore us down.
        instance.destroy();
        plugin.removeInstance(webviewId);
      }
      plugin.sendEventToCordova(webviewId, "closed", null);
    }

    webView = null;
    container = null;
  }
}

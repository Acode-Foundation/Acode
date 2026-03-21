package com.foxdebug.browser;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.view.Window;
import android.view.WindowInsetsController;
import android.webkit.WebChromeClient;
import com.foxdebug.system.Ui;
import org.json.JSONObject;

public class BrowserActivity extends Activity {

  private Browser browser;
  private Ui.Theme theme;

  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);

    Intent intent = getIntent();
    String url = intent.getStringExtra("url");
    String themeString = intent.getStringExtra("theme");
    boolean onlyConsole = intent.getBooleanExtra("onlyConsole", false);

    try {
      JSONObject obj = new JSONObject(themeString);
      theme = new Ui.Theme(obj);
    } catch (Exception e) {
      theme = new Ui.Theme(new JSONObject());
    }

    browser = new Browser(this, theme, onlyConsole);
    browser.setUrl(url);
    setContentView(browser);
    setSystemTheme(theme.get("primaryColor"));
  }

  @Override
  public void onBackPressed() {
    boolean didGoBack = browser.goBack();

    if (!didGoBack) {
      browser.exit();
    }
  }

  private void setSystemTheme(int systemBarColor) {
    try {
      Ui.Icons.setSize(Ui.dpToPixels(this, 18));
      final Window window = getWindow();
      // Method and constants not available on all SDKs but we want to be able to compile this code with any SDK
      window.clearFlags(0x04000000); // SDK 19: WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS);
      window.addFlags(0x80000000); // SDK 21: WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
      try {
        // Using reflection makes sure any 5.0+ device will work without having to compile with SDK level 21

        window
          .getClass()
          .getMethod("setNavigationBarColor", int.class)
          .invoke(window, systemBarColor);

        window
          .getClass()
          .getMethod("setStatusBarColor", int.class)
          .invoke(window, systemBarColor);

        if (Build.VERSION.SDK_INT < 30) {
          setStatusBarStyle(window);
          setNavigationBarStyle(window);
        } else {
          String themeType = theme.getType();
          WindowInsetsController controller = window.getInsetsController();
          int appearance =
            WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS |
            WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;

          if (themeType.equals("light")) {
            controller.setSystemBarsAppearance(appearance, appearance);
          } else {
            controller.setSystemBarsAppearance(0, appearance);
          }
        }
      } catch (IllegalArgumentException error) {
        Log.w("BrowserActivity", "Invalid system bar color or appearance input.", error);
      } catch (Exception error) {
        Log.w("BrowserActivity", "Failed applying system bar theme values.", error);
      }
    } catch (Exception e) {
      Log.e("BrowserActivity", "Failed to apply system theme.", e);
    }
  }

  private void setStatusBarStyle(final Window window) {
    View decorView = window.getDecorView();
    int uiOptions = decorView.getSystemUiVisibility();
    String themeType = theme.getType();

    if (themeType.equals("light")) {
      decorView.setSystemUiVisibility(
        uiOptions | View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
      );
      return;
    }
  }

  private void setNavigationBarStyle(final Window window) {
    View decorView = window.getDecorView();
    int uiOptions = decorView.getSystemUiVisibility();
    String themeType = theme.getType();

    if (themeType.equals("light")) {
      decorView.setSystemUiVisibility(uiOptions | 0x80000000 | 0x00000010);
      return;
    }
  }

  @Override
  protected void onActivityResult(
    int requestCode,
    int resultCode,
    Intent data
  ) {
    super.onActivityResult(requestCode, resultCode, data);

    if (requestCode == browser.FILE_SELECT_CODE) {
      if (browser.filePathCallback == null) {
        return;
      }

      browser.filePathCallback.onReceiveValue(
        WebChromeClient.FileChooserParams.parseResult(resultCode, data)
      );

      browser.filePathCallback = null;
    }
  }
}

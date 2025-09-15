package com.foxdebug.browser;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.text.InputType;
import android.text.TextUtils;
import android.util.Log;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewTreeObserver;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.webkit.ConsoleMessage;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ImageButton;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import com.foxdebug.browser.Emulator;
import com.foxdebug.browser.Menu;
import com.foxdebug.system.Ui;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;
import java.io.IOException;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.Context;
import android.net.Uri;
import android.os.Environment;
import android.webkit.DownloadListener;
import android.webkit.URLUtil;
import android.webkit.WebView;
import android.widget.Toast;
import android.os.Handler;
import android.os.Looper;




public class Browser extends LinearLayout {

  public int FILE_SELECT_CODE = 1;

  public Menu menu;
  public WebView webView;
  private Ui.Theme theme;
  public Context context;
  private TextView urlText;
  private LinearLayout main;
  private ImageView favicon;
  private TextView titleText;
  private ProgressBar loading;
  private Emulator deviceEmulator;

  public boolean emulator = false;
  public boolean console = false;
  public boolean desktopMode = false;

  private String url = "";
  private String title = "Browser";

  private int padding;
  private int fontSize;
  private int imageSize;
  private int titleHeight;
  private int titleTextHeight;
  private boolean onlyConsole;

  ValueCallback<Uri[]> filePathCallback;
  final int REQUEST_SELECT_FILE = 1;

  public Browser(Context context, Ui.Theme theme, Boolean onlyConsole) {
    super(context);
    this.theme = theme;
    this.context = context;
    this.onlyConsole = onlyConsole;
    this.padding = Ui.dpToPixels(context, 5);
    this.fontSize = Ui.dpToPixels(context, 5);
    this.imageSize = Ui.dpToPixels(context, 35);
    this.titleHeight = Ui.dpToPixels(context, 45);
    this.titleTextHeight = Ui.dpToPixels(context, 35);

    this.init();
  }

  public void init() {
    WebSettings settings;
    ImageButton menuIcon;
    ImageButton refreshIcon;
    LinearLayout titleLayout;
    FrameLayout faviconFrame;
    LinearLayout webViewContainer;
    LinearLayout.LayoutParams faviconFrameParams;

    favicon = createIcon(Ui.Icons.LOGO);
    menuIcon = createIconButton(Ui.Icons.MORE_VERT);
    menuIcon.setOnClickListener(
      new View.OnClickListener() {
        @Override
        public void onClick(View view) {
          menu.show(view);
        }
      }
    );

    refreshIcon = createIconButton(Ui.Icons.REFRESH);
    refreshIcon.setOnClickListener(
      new View.OnClickListener() {
        @Override
        public void onClick(View v) {
          webView.reload();
        }
      }
    );

    loading = new ProgressBar(context, null, android.R.attr.progressBarStyle);
    loading.setLayoutParams(
      new LinearLayout.LayoutParams(this.imageSize, this.imageSize, 0)
    );

    faviconFrame = new FrameLayout(context);
    faviconFrameParams = new LinearLayout.LayoutParams(
      ViewGroup.LayoutParams.WRAP_CONTENT,
      ViewGroup.LayoutParams.WRAP_CONTENT
    );
    faviconFrameParams.gravity = Gravity.CENTER_VERTICAL;
    faviconFrame.setLayoutParams(faviconFrameParams);
    faviconFrame.addView(favicon);
    faviconFrame.addView(loading);

    titleLayout = createTile();
    titleLayout.addView(faviconFrame);
    titleText = onlyConsole ? createTextView(title) : createEditText(title);
    titleLayout.addView(titleText);
    if (!onlyConsole) {
      titleLayout.addView(refreshIcon);
      titleLayout.addView(menuIcon);
    }

    webView = new WebView(context);
    webView.setFocusable(true);
    webView.setFocusableInTouchMode(true);
    webView.setBackgroundColor(0xFFFFFFFF);


    webView.setDownloadListener(new DownloadListener() {
        @Override
        public void onDownloadStart(String url, String userAgent,
                                    String contentDisposition, String mimeType,
                                    long contentLength) {

            String fileName = URLUtil.guessFileName(url, contentDisposition, mimeType);

            new Handler(Looper.getMainLooper()).post(() -> {

              new AlertDialog.Builder(getContext())
                .setTitle("Download file")
                .setMessage("Do you want to download \"" + fileName + "\"?")
                .setPositiveButton("Yes", (dialog, which) -> {
                    DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
                    request.setMimeType(mimeType);
                    request.addRequestHeader("User-Agent", userAgent);
                    request.setDescription("Downloading file...");
                    request.setTitle(fileName);
                    request.allowScanningByMediaScanner();
                    request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                    request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName);

                    DownloadManager dm = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
                    dm.enqueue(request);

                    Toast.makeText(getContext(), "Download started...", Toast.LENGTH_SHORT).show();
                })
                .setNegativeButton("Cancel", null)
                .show();


            });
            
        }
    });


    fitWebViewTo(0, 0, 1);

    webView.setWebChromeClient(new BrowserChromeClient(this));
    webView.setWebViewClient(new BrowserWebViewClient(this));

    settings = webView.getSettings();
    settings.setJavaScriptEnabled(true);
    settings.setDomStorageEnabled(true);
    settings.setAllowContentAccess(true);
    settings.setDisplayZoomControls(false);
    settings.setDomStorageEnabled(true);

    webViewContainer = new LinearLayout(context);
    webViewContainer.setGravity(Gravity.CENTER);
    webViewContainer.setLayoutParams(
      new LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.MATCH_PARENT,
        1
      )
    );
    webViewContainer.setBackgroundColor(theme.get("primaryColor"));
    webViewContainer.addView(webView);

    setOrientation(LinearLayout.VERTICAL);
    setFocusableInTouchMode(true);
    setFocusable(true);
    createMenu();
    addView(titleLayout);
    addView(webViewContainer);
  }

  private void createMenu() {
    Browser browser = this;
    menu = new Menu(context, theme);

    menu.addItem(Ui.Icons.DEVICES, "Devices", false);
    menu.addItem(Ui.Icons.NO_CACHE, "Disable Cache", false);
    menu.addItem(Ui.Icons.TERMINAL, "Console", false);
    menu.addItem(Ui.Icons.OPEN_IN_BROWSER, "Open in Browser");
    menu.addItem(Ui.Icons.EXIT, "Exit");

    menu.setCallback(
      new Menu.Callback() {
        @Override
        public void onSelect(String action, Boolean checked) {
          switch (action) {
            case "Devices":
              if (deviceEmulator == null) {
                createDeviceEmulatorLayout();
              }

              emulator = checked;
              if (checked) {
                setDesktopMode(true);
                setConsoleVisible(false);
                menu.setChecked("Console", false);
                menu.setVisible("Console", false);
                addView(deviceEmulator);
                fitWebViewTo(
                  deviceEmulator.getWidthProgress(),
                  deviceEmulator.getHeightProgress(),
                  deviceEmulator.getScaleProgress()
                );
              } else {
                menu.setVisible("Console", true);
                removeView(deviceEmulator);
                fitWebViewTo(0, 0, 1);
                webView
                  .getViewTreeObserver()
                  .addOnGlobalLayoutListener(
                    new ViewTreeObserver.OnGlobalLayoutListener() {
                      @Override
                      public void onGlobalLayout() {
                        webView
                          .getViewTreeObserver()
                          .removeOnGlobalLayoutListener(this);
                        setDesktopMode(false);
                      }
                    }
                  );
              }

              break;
            case "Console":
              setConsoleVisible(checked);
              break;
            case "Disable Cache":
              webView
                .getSettings()
                .setCacheMode(
                  checked ? WebSettings.LOAD_NO_CACHE : WebSettings.LOAD_DEFAULT
                );
              break;
            case "Open in Browser":
              Intent browserIntent = new Intent(
                Intent.ACTION_VIEW,
                Uri.parse(url)
              );
              context.startActivity(browserIntent);
              exit();
              break;
            case "Exit":
              exit();
              break;
          }
        }
      }
    );
  }

  private void createDeviceEmulatorLayout() {
    Browser browser = this;
    deviceEmulator = new Emulator(context, theme);
    deviceEmulator.setReference(webView);
    deviceEmulator.setChangeListener(
      new Emulator.Callback() {
        @Override
        public void onChange(int width, int height, float scale) {
          fitWebViewTo(width, height, scale);
        }
      }
    );
  }

  private void setTextViewProperties(TextView textView, int height) {
    LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
      ViewGroup.LayoutParams.FILL_PARENT,
      height,
      1
    );
    params.gravity = Gravity.CENTER_VERTICAL;
    textView.setMaxLines(1);
    textView.setEllipsize(TextUtils.TruncateAt.END);
    textView.setSingleLine(true);
    textView.setHorizontallyScrolling(true);
    textView.setTextColor(theme.get("primaryTextColor"));
    textView.setLayoutParams(params);
    textView.setGravity(Gravity.CENTER_VERTICAL);
  }

  private void setDesktopMode(boolean enabled) {
    int width = 0;
    int height = 0;
    WebSettings webSettings = webView.getSettings();

    desktopMode = enabled;
    webSettings.setUserAgentString(
      enabled
        ? "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36"
        : null
    );

    if (enabled) {
      width = webView.getMeasuredWidth();
      height = webView.getMeasuredHeight();
    }

    webSettings.setLoadWithOverviewMode(enabled);
    webSettings.setUseWideViewPort(enabled);
    webSettings.setLoadWithOverviewMode(enabled);
    webSettings.setSupportZoom(enabled);
    webSettings.setBuiltInZoomControls(enabled);
    webView.reload();
  }

  public void setDesktopMode() {
    if (desktopMode) {
      int width = webView.getMeasuredWidth();
      int height = webView.getMeasuredHeight();
      updateViewportDimension(width, height);
    }
  }

  public void setUrl(String url) {
    this.url = url;
    setTitle(url);
    setProgressBarVisible(true);
    webView.loadUrl(url);
  }

  public void setTitle(String title) {
    this.title = title;
    titleText.setText(title);
  }

  public void setFavicon(Bitmap icon) {
    favicon.setImageBitmap(icon);
  }

  public void setConsoleVisible(boolean visible) {
    console = visible;
    String javascript = "document.dispatchEvent(new CustomEvent('%sconsole'))";
    javascript = String.format(javascript, visible ? "show" : "hide");
    webView.evaluateJavascript(javascript, null);
  }

  public void setProgressBarVisible(boolean visible) {
    loading.setVisibility(visible ? View.VISIBLE : View.GONE);
  }

  private void updateViewportDimension(int width, int height) {
    String script =
      "!function(){var e=document.head;if(e){e.querySelectorAll(\"meta[name=viewport]\").forEach(function(e){e.remove()});var t=document.createElement(\"meta\");t.name=\"viewport\",t.content=\"width=%s, height=%s, initial-scale=%s\",e.append(t)}}();";
    String w = "device-width";
    String h = "device-height";
    String r = "1";
    if (width > 0) {
      w = String.valueOf(width);
      r = "0.1";
      h = "";
    }

    if (height > 0) {
      h = String.valueOf(height);
    }

    webView.evaluateJavascript(String.format(script, w, h, r), null);
  }

  private void fitWebViewTo(int width, int height, float scale) {
    webView.setScaleX(scale);
    webView.setScaleY(scale);
    webView.setLayoutParams(
      new LinearLayout.LayoutParams(
        width == 0 ? ViewGroup.LayoutParams.MATCH_PARENT : width,
        height == 0 ? ViewGroup.LayoutParams.MATCH_PARENT : height
      )
    );
    if (width > 0 && height > 0) {
      updateViewportDimension(width, height);
    }
  }

  private void styleIcon(ImageView view) {
    int padding = Ui.dpToPixels(context, 7);
    LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
      imageSize,
      imageSize
    );

    params.gravity = Gravity.CENTER_VERTICAL;
    view.setBackgroundDrawable(null);
    view.setLayoutParams(params);
    view.setScaleType(ImageView.ScaleType.FIT_CENTER);
    view.setAdjustViewBounds(true);
    view.setPadding(padding, padding, padding, padding);
  }

  private void keyboardVisible(boolean visible) {
    if (visible) {
      InputMethodManager imm = (InputMethodManager) context.getSystemService(
        Context.INPUT_METHOD_SERVICE
      );
      imm.toggleSoftInput(InputMethodManager.SHOW_FORCED, 0);
    } else {
      InputMethodManager imm = (InputMethodManager) context.getSystemService(
        Context.INPUT_METHOD_SERVICE
      );
      imm.hideSoftInputFromWindow(webView.getWindowToken(), 0);
    }
  }

  public boolean goBack() {
    if (console) {
      menu.setChecked("Console", false);
      setConsoleVisible(false);
      return true;
    }

    if (webView.canGoBack()) {
      webView.goBack();
      url = webView.getOriginalUrl();
      return true;
    }

    return false;
  }

  private TextView createTextView(String text) {
    TextView textView = new TextView(context);
    setTextViewProperties(textView, this.titleHeight);
    textView.setText(text);
    return textView;
  }

  private EditText createEditText(String text) {
    EditText editText = new EditText(context);
    GradientDrawable background = new GradientDrawable();
    String themeType = theme.getType();

    int radius = this.titleTextHeight / 2;
    background.setCornerRadius(radius);
    background.setColor(themeType.equals("light") ? 0x11000000 : 0x11ffffff);
    editText.setBackground(background);

    setTextViewProperties(editText, this.titleTextHeight);
    editText.setText(text);
    editText.setPadding(radius, 0, radius, 0);
    editText.setTextSize(this.fontSize < 10 ? 10 : this.fontSize);
    editText.setInputType(InputType.TYPE_TEXT_VARIATION_URI);
    editText.setImeOptions(EditorInfo.IME_ACTION_GO);

    editText.setOnFocusChangeListener(
      new View.OnFocusChangeListener() {
        @Override
        public void onFocusChange(View v, boolean hasFocus) {
          if (hasFocus) {
            titleText.setText(url);
            keyboardVisible(true);
          } else {
            titleText.setText(title);
            keyboardVisible(false);
          }
        }
      }
    );

    editText.setOnEditorActionListener(
      new EditText.OnEditorActionListener() {
        @Override
        public boolean onEditorAction(
          TextView v,
          int actionId,
          KeyEvent event
        ) {
          if (actionId == EditorInfo.IME_ACTION_GO) {
            String url = v.getText().toString();
            if (!url.startsWith("http://") && !url.startsWith("https://")) {
              url = "http://" + url;
            }

            title = url;
            setUrl(url);
            editText.clearFocus();
            keyboardVisible(false);
            return true;
          }
          return false;
        }
      }
    );

    return editText;
  }

  private LinearLayout createTile() {
    return createTile(titleHeight);
  }

  private LinearLayout createTile(int height) {
    LinearLayout tile = new LinearLayout(context);
    tile.setOrientation(LinearLayout.HORIZONTAL);
    tile.setBackgroundColor(theme.get("primaryColor"));
    tile.setLayoutParams(
      new LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, height)
    );
    tile.setHorizontalGravity(Gravity.LEFT);
    tile.setVerticalGravity(Gravity.TOP);
    return tile;
  }

  private ImageButton createIconButton(String icon) {
    Bitmap bitmap = Ui.Icons.get(context, icon, theme.get("primaryTextColor"));
    ImageButton button = createIconButton(bitmap);
    return button;
  }

  private ImageButton createIconButton(Bitmap icon) {
    ImageButton button = new ImageButton(context);
    button.setImageBitmap(icon);
    styleIcon(button);
    return button;
  }

  private ImageView createIcon(String code) {
    Bitmap bitmap = Ui.Icons.get(context, code, theme.get("primaryTextColor"));
    ImageView icon = new ImageView(context);
    icon.setImageBitmap(bitmap);
    styleIcon(icon);
    return icon;
  }

  public void exit() {
    if (console) {
      setConsoleVisible(false);
      return;
    }

    if (webView.canGoBack()) {
      webView.goBack();
      return;
    }

    webView.destroy();
    ((Activity) context).finish();
  }
}

class BrowserChromeClient extends WebChromeClient {

  Browser browser;

  public BrowserChromeClient(Browser browser) {
    super();
    this.browser = browser;
  }

  @Override
  public void onReceivedTitle(WebView view, String title) {
    super.onReceivedTitle(view, title);
    browser.setTitle(title);
  }

  @Override
  public void onReceivedIcon(WebView view, Bitmap icon) {
    super.onReceivedIcon(view, icon);
    browser.setFavicon(icon);
  }

  public boolean onShowFileChooser(
    WebView webView,
    ValueCallback<Uri[]> filePathCallback,
    WebChromeClient.FileChooserParams fileChooserParams
  ) {
    if (browser.filePathCallback != null) {
      browser.filePathCallback.onReceiveValue(null);
    }
    browser.filePathCallback = filePathCallback;

    String[] acceptTypes = fileChooserParams.getAcceptTypes();
    String mimeType = "*/*"; // default if empty or null
    if (acceptTypes != null && acceptTypes.length > 0) {
      String firstType = acceptTypes[0];
      if (firstType != null && !firstType.trim().isEmpty()) {
        mimeType = firstType;
      }
    }

    Intent selectDocument = new Intent(Intent.ACTION_GET_CONTENT);
    selectDocument.addCategory(Intent.CATEGORY_OPENABLE);
    selectDocument.setType(mimeType);

    boolean isMultiple =
      (fileChooserParams.getMode() ==
        WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE);
    if (isMultiple) {
      selectDocument.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
    }

    ((Activity) webView.getContext()).startActivityForResult(
        Intent.createChooser(selectDocument, "Select File"),
        browser.FILE_SELECT_CODE
      );

    return true;
  }
}

class BrowserWebViewClient extends WebViewClient {

  private Browser browser;

  public BrowserWebViewClient(Browser browser) {
    super();
    this.browser = browser;
  }

  @Override
  public boolean shouldOverrideUrlLoading(WebView view, String url) {
    browser.setUrl(url);
    browser.setProgressBarVisible(true);
    return false;
  }

  @Override
  public void onPageStarted(WebView view, String url, Bitmap icon) {
    super.onPageStarted(view, url, icon);
    browser.setProgressBarVisible(true);
  }

  @Override
  public void onPageFinished(WebView view, String url) {
    super.onPageFinished(view, url);
    browser.setProgressBarVisible(false);

    // Inject console for external sites
    // this is not a good solution but for now its good, later we'll improve this
    if (!url.startsWith("http://localhost")) {
      try {
        File eruaFile = new File(browser.context.getFilesDir(), "eruda.js");
        StringBuilder scriptContent = new StringBuilder();
        BufferedReader reader = new BufferedReader(new FileReader(eruaFile));
        String line;
        while ((line = reader.readLine()) != null) {
          scriptContent.append(line);
          scriptContent.append("\n");
        }
        reader.close();

        // Inject the script content directly
        String script =
          "if(!window.eruda){" +
          "  var script = document.createElement('script');" +
          "  script.textContent = `" +
          scriptContent.toString() +
          "`;" +
          "  document.head.appendChild(script);" +
          "  eruda.init({" +
          "    theme: 'dark'" +
          "  });" +
          "  eruda._shadowRoot.querySelector('.eruda-entry-btn').style.display = 'none';" +
          "  sessionStorage.setItem('__console_available', true);" +
          "  document.addEventListener('showconsole', function() { eruda.show(); });" +
          "  document.addEventListener('hideconsole', function() { eruda.hide(); });" +
          "}";

        browser.webView.evaluateJavascript(script, null);
      } catch (IOException e) {
        e.printStackTrace();
        // Fallback to CDN if local file fails
        String fallbackScript =
          "if(!window.eruda){" +
          "  var script = document.createElement('script');" +
          "  script.src = 'https://cdn.jsdelivr.net/npm/eruda';" +
          "  script.crossOrigin = 'anonymous';" +
          "  script.onload = function() {" +
          "    eruda.init({" +
          "      theme: 'dark'" +
          "    });" +
          "    eruda._shadowRoot.querySelector('.eruda-entry-btn').style.display = 'none';" +
          "    sessionStorage.setItem('__console_available', true);" +
          "    document.addEventListener('showconsole', function() { eruda.show(); });" +
          "    document.addEventListener('hideconsole', function() { eruda.hide(); });" +
          "  };" +
          "  document.head.appendChild(script);" +
          "}";
        browser.webView.evaluateJavascript(fallbackScript, null);
      }
      browser.menu.setChecked("Console", false);
    } else {
      browser.webView.evaluateJavascript(
        "sessionStorage.getItem('__console_available')",
        new ValueCallback<String>() {
          @Override
          public void onReceiveValue(String value) {
            boolean show = !value.equals("null");
            browser.menu.setVisible("Console", show && !browser.emulator);

            // If user had toggled "Console" on before, re-show it
            if (browser.console && show) {
              browser.setConsoleVisible(true);
              browser.menu.setChecked("Console", true);
            }
          }
        }
      );
    }
  }

  @Override
  public void onLoadResource(WebView view, String url) {
    browser.setDesktopMode();
  }
}

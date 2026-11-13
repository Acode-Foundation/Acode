package com.foxdebug.system;

import static android.os.Build.VERSION.SDK_INT;

import android.Manifest;
import android.app.Activity;
import android.app.PendingIntent;
import android.content.*;
import android.content.pm.*;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.ImageDecoder;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.PowerManager;
import android.provider.DocumentsContract;
import android.provider.MediaStore;
import android.provider.Settings;
import android.provider.Settings.Global;
import android.util.Base64;
import android.util.Log;
import android.util.TypedValue;
import android.view.View;
import android.view.Window;
import android.view.WindowInsetsController;
import android.view.inputmethod.InputMethodManager;
import android.webkit.MimeTypeMap;
import android.webkit.WebView;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import androidx.core.content.pm.ShortcutInfoCompat;
import androidx.core.content.pm.ShortcutManagerCompat;
import androidx.core.graphics.drawable.IconCompat;
import androidx.documentfile.provider.DocumentFile;
import com.foxdebug.system.Ui.Theme;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.nio.ByteBuffer;
import java.nio.CharBuffer;
import java.nio.charset.Charset;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardOpenOption;
import java.security.MessageDigest;
import java.util.*;
import org.apache.cordova.CallbackContext;
import org.apache.cordova.CordovaInterface;
import org.apache.cordova.CordovaPlugin;
import org.apache.cordova.CordovaWebView;
import org.apache.cordova.CordovaWebViewImpl;
import org.apache.cordova.PluginResult;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

public class System extends CordovaPlugin {

  private static final String TAG = "SystemPlugin";

  private CallbackContext requestPermissionCallback;
  private static final Map<String, String> APP_ICON_ALIASES;

  static {
    Map<String, String> aliases = new HashMap<>();
    aliases.put("default", "MainActivityIconDefault");
    aliases.put("pro", "MainActivityIconPro");
    aliases.put("midnight_circuit", "MainActivityIconMidnightCircuit");
    aliases.put("aurora_pulse", "MainActivityIconAuroraPulse");
    aliases.put("terminal_glow", "MainActivityIconTerminalGlow");
    aliases.put("solar_flare", "MainActivityIconSolarFlare");
    aliases.put("blueprint", "MainActivityIconBlueprint");
    aliases.put("pixel_party", "MainActivityIconPixelParty");
    aliases.put("prism", "MainActivityIconPrism");
    aliases.put("porcelain", "MainActivityIconPorcelain");
    aliases.put("tangerine", "MainActivityIconTangerine");
    aliases.put("tidal", "MainActivityIconTidal");
    aliases.put("lilac", "MainActivityIconLilac");
    aliases.put("volt", "MainActivityIconVolt");
    aliases.put("cobalt", "MainActivityIconCobalt");
    aliases.put("glacier", "MainActivityIconGlacier");
    APP_ICON_ALIASES = Collections.unmodifiableMap(aliases);
  }

  private Activity activity;
  private Context context;
  private int REQ_PERMISSIONS = 1;
  private int REQ_PERMISSION = 2;
  private int systemBarColor = 0xFF000000;
  private Theme theme;
  private CallbackContext intentHandler;
  private CordovaWebView webView;
  private String fileProviderAuthority;
  private RewardPassManager rewardPassManager;

  public void initialize(CordovaInterface cordova, CordovaWebView webView) {
    super.initialize(cordova, webView);
    this.context = cordova.getContext();
    this.activity = cordova.getActivity();
    this.webView = webView;
    this.rewardPassManager = new RewardPassManager(this.context);
    this.activity.runOnUiThread(
      new Runnable() {
        @Override
        public void run() {
          setNativeContextMenuDisabled(false);
        }
      }
    );
  }

  @Override
  public void onReset() {
    super.onReset();
    StreamHttp.cancelAll();
    intentHandler = null;
  }

  @Override
  public void onDestroy() {
    StreamHttp.cancelAll();
    super.onDestroy();
  }

  public boolean execute(
    String action,
    final JSONArray args,
    final CallbackContext callbackContext
  ) throws JSONException {
    final String arg1 = args.optString(0);
    final String arg2 = args.optString(1);
    final String arg3 = args.optString(2);
    final String arg4 = args.optString(3);
    final String arg5 = args.optString(4);
    final String arg6 = args.optString(5);

    switch (action) {
      case "get-webkit-info":
      case "file-action":
      case "checksumText":
      case "is-powersave-mode":
      case "get-app-info":
      case "add-shortcut":
      case "remove-shortcut":
      case "pin-shortcut":
      case "get-android-version":
      case "request-permissions":
      case "request-permission":
      case "has-permission":
      case "open-in-browser":
      case "launch-app":
      case "launch-app-with-file":
      case "get-global-setting":
      case "get-available-encodings":
      case "decode":
      case "encode":
      case "copyToUri":
      case "getInstaller":
      case "compare-file-text":
      case "compare-texts":
      case "extractAsset":
      case "pin-file-shortcut":
        break;
      case "get-configuration":
        getConfiguration(callbackContext);
        return true;
      case "set-fullscreen-back-handler":
        final boolean fullscreenBackHandler = args.getBoolean(0);
        activity.runOnUiThread(() -> {
          try {
            ((CordovaWebViewImpl) webView).setFullscreenBackHandler(fullscreenBackHandler);
            callbackContext.success();
          } catch (RuntimeException error) {
            callbackContext.error(error.getMessage());
          }
        });
        return true;
      case "set-fullscreen-orientation":
        final String orientation = args.isNull(0) ? null : args.getString(0);
        activity.runOnUiThread(() -> {
          try {
            ((CordovaWebViewImpl) webView).setFullscreenOrientation(orientation);
            callbackContext.success();
          } catch (RuntimeException error) {
            callbackContext.error(error.getMessage());
          }
        });
        return true;
      case "http-stream-start":
        httpStreamStart(args, callbackContext);
        return true;
      case "http-stream-ack":
        StreamHttp.ack(arg1, args.optInt(1, 0));
        callbackContext.success();
        return true;
      case "http-stream-cancel":
        StreamHttp.cancel(arg1);
        callbackContext.success();
        return true;
      case "set-input-type":
        setInputType(arg1);
        callbackContext.success();
        return true;
      case "set-native-context-menu-disabled":
        this.cordova.getActivity().runOnUiThread(
          new Runnable() {
            @Override
            public void run() {
              setNativeContextMenuDisabled(Boolean.parseBoolean(arg1));
              callbackContext.success();
            }
          }
        );
        return true;
      case "set-app-icon":
        setAppIcon(arg1, callbackContext);
        return true;
      case "get-cordova-intent":
        getCordovaIntent(callbackContext);
        return true;
      case "set-intent-handler":
        setIntentHandler(callbackContext);
        return true;
      case "shareText":
        String text = args.getString(0);

        cordova.getActivity().runOnUiThread(() -> {
          try {
            Intent shareIntent = new Intent(Intent.ACTION_SEND);
            shareIntent.setType("text/plain");
            shareIntent.putExtra(Intent.EXTRA_TEXT, text);

            cordova
              .getActivity()
              .startActivity(Intent.createChooser(shareIntent, "Share"));

            callbackContext.success();
          } catch (Exception e) {
            callbackContext.error(e.getMessage());
          }
        });
        return true;
      case "set-ui-theme":
        this.cordova.getActivity().runOnUiThread(
          new Runnable() {
            public void run() {
              setUiTheme(arg1, args.optJSONObject(1), callbackContext);
            }
          }
        );
        return true;
      case "clear-cache":
        this.cordova.getActivity().runOnUiThread(
          new Runnable() {
            public void run() {
              clearCache(callbackContext);
            }
          }
        );
        return true;
      case "fileExists":
        callbackContext.success(
          fileExists(args.getString(0), args.getString(1)) ? 1 : 0
        );
        return true;
      case "createSymlink":
        boolean success = createSymlink(args.getString(0), args.getString(1));
        callbackContext.success(success ? 1 : 0);
        return true;
      case "getNativeLibraryPath":
        callbackContext.success(getNativeLibraryPath());
        return true;
      case "getFilesDir":
        callbackContext.success(getFilesDir());
        return true;
      case "getRewardStatus":
        callbackContext.success(rewardPassManager.getRewardStatus());
        return true;
      case "redeemReward":
        callbackContext.success(
          rewardPassManager.redeemReward(args.getString(0))
        );
        return true;
      case "getParentPath":
        callbackContext.success(getParentPath(args.getString(0)));
        return true;
      case "listChildren":
        callbackContext.success(listChildren(args.getString(0)));
        return true;
      case "writeText": {
        try {
          String filePath = args.getString(0);
          String content = args.getString(1);

          Files.write(
            Paths.get(filePath),
            Collections.singleton(content),
            StandardOpenOption.CREATE,
            StandardOpenOption.TRUNCATE_EXISTING
          );

          callbackContext.success("File written successfully");
        } catch (Exception e) {
          callbackContext.error("Failed to write file: " + e.getMessage());
        }
        return true;
      }
      case "getArch":
        String arch;

        if (android.os.Build.VERSION.SDK_INT >= 21) {
          arch = android.os.Build.SUPPORTED_ABIS[0];
        } else {
          arch = android.os.Build.CPU_ABI;
        }

        callbackContext.success(arch);
        return true;
      case "requestStorageManager":
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
          try {
            Intent intent = new Intent(
              Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION
            );
            intent.setData(Uri.parse("package:" + context.getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
            callbackContext.success("true");
          } catch (Exception e) {
            // Fallback to general settings if specific one fails
            Intent intent = new Intent(
              Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION
            );
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
            callbackContext.success("true");
          }
        } else {
          callbackContext.success("false"); // Not needed on Android < 11
        }
        return true;
      case "hasGrantedStorageManager":
        boolean granted;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
          granted = Environment.isExternalStorageManager();
        } else {
          // Fallback for Android 10 and below
          granted =
            ContextCompat.checkSelfPermission(
              context,
              Manifest.permission.READ_EXTERNAL_STORAGE
            ) == PackageManager.PERMISSION_GRANTED;
        }
        callbackContext.success(String.valueOf(granted));
        return true;
      case "isManageExternalStorageDeclared":
        PackageManager pm = context.getPackageManager();
        try {
          PackageInfo info = pm.getPackageInfo(
            context.getPackageName(),
            PackageManager.GET_PERMISSIONS
          );
          String[] permissions = info.requestedPermissions;
          String isDeclared = "false";

          if (permissions != null) {
            for (String perm : permissions) {
              if (perm.equals("android.permission.MANAGE_EXTERNAL_STORAGE")) {
                isDeclared = "true";
                break;
              }
            }
          }
          callbackContext.success(isDeclared);
        } catch (PackageManager.NameNotFoundException e) {
          e.printStackTrace();
          callbackContext.error(e.toString());
        }

        return true;
      case "mkdirs":
        if (new File(args.getString(0)).mkdirs()) {
          callbackContext.success();
        } else {
          callbackContext.error("mkdirs failed");
        }
        return true;
      case "deleteFile":
        if (new File(args.getString(0)).delete()) {
          callbackContext.success();
        } else {
          callbackContext.error("delete failed");
        }
        return true;
      case "setExec":
        if (
          new File(args.getString(0)).setExecutable(
            Boolean.parseBoolean(args.getString(1))
          )
        ) {
          callbackContext.success();
        } else {
          callbackContext.error("set exec failed");
        }

        return true;
      default:
        return false;
    }

    cordova.getThreadPool().execute(
      new Runnable() {
        public void run() {
          switch (action) {
            case "extractAsset":
              try {
                String assetName = args.getString(0);
                String destinationPath = args.getString(1);
                extractAsset(assetName, destinationPath, callbackContext);
              } catch (Exception e) {
                callbackContext.error(
                  "Failed to extract asset: " + e.getMessage()
                );
              }
              return;
            case "getInstaller":
              try {
                PackageManager pm = context.getPackageManager();

                String installer;

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                  InstallSourceInfo info = pm.getInstallSourceInfo(
                    context.getPackageName()
                  );

                  installer = info.getInstallingPackageName();
                } else {
                  installer = pm.getInstallerPackageName(
                    context.getPackageName()
                  );
                }

                callbackContext.success(installer);
              } catch (Exception e) {
                callbackContext.error(e.getMessage());
              }
              break;
            case "copyToUri":
              try {
                //srcUri is a file
                Uri srcUri = Uri.parse(args.getString(0));

                //destUri is a directory
                Uri destUri = Uri.parse(args.getString(1));

                //create a file named this into the dest Directory and copy the srcUri into it
                String fileName = args.getString(2);

                InputStream in = null;
                OutputStream out = null;
                try {
                  // Open input stream from the source URI
                  if ("file".equalsIgnoreCase(srcUri.getScheme())) {
                    File file = new File(srcUri.getPath());
                    in = new FileInputStream(file);
                  } else {
                    in = context.getContentResolver().openInputStream(srcUri);
                  }

                  // Create the destination file using DocumentFile for better URI handling
                  DocumentFile destFile = null;

                  if ("file".equalsIgnoreCase(destUri.getScheme())) {
                    // Handle file:// scheme using DocumentFile
                    File destDir = new File(destUri.getPath());
                    if (!destDir.exists()) {
                      destDir.mkdirs(); // Create directory if it doesn't exist
                    }
                    DocumentFile destDocDir = DocumentFile.fromFile(destDir);

                    // Check if file already exists and delete it
                    DocumentFile existingFile = destDocDir.findFile(fileName);
                    if (existingFile != null && existingFile.exists()) {
                      existingFile.delete();
                    }

                    // Create new file
                    String mimeType = getMimeTypeFromExtension(fileName);
                    destFile = destDocDir.createFile(mimeType, fileName);
                  } else {
                    // Handle content:// scheme using DocumentFile
                    DocumentFile destDocDir = DocumentFile.fromTreeUri(
                      context,
                      destUri
                    );

                    if (
                      destDocDir == null ||
                      !destDocDir.exists() ||
                      !destDocDir.isDirectory()
                    ) {
                      callbackContext.error(
                        "Destination directory does not exist or is not accessible"
                      );
                      return;
                    }

                    // Check if file already exists and delete it
                    DocumentFile existingFile = destDocDir.findFile(fileName);
                    if (existingFile != null && existingFile.exists()) {
                      existingFile.delete();
                    }

                    // Create new file
                    String mimeType = getMimeTypeFromExtension(fileName);
                    destFile = destDocDir.createFile(mimeType, fileName);
                  }

                  if (destFile == null || !destFile.exists()) {
                    callbackContext.error("Failed to create destination file");
                    return;
                  }

                  // Open output stream to the created file
                  out = context
                    .getContentResolver()
                    .openOutputStream(destFile.getUri());

                  if (in == null || out == null) {
                    callbackContext.error("uri streams are null");
                    return;
                  }

                  // Copy stream
                  byte[] buffer = new byte[8192];
                  int len;
                  while ((len = in.read(buffer)) > 0) {
                    out.write(buffer, 0, len);
                  }

                  out.flush();
                  callbackContext.success();
                } catch (IOException e) {
                  e.printStackTrace();
                  callbackContext.error(e.toString());
                } finally {
                  try {
                    if (in != null) in.close();
                    if (out != null) out.close();
                  } catch (IOException e) {
                    e.printStackTrace();
                    callbackContext.error(e.toString());
                  }
                }
              } catch (Exception e) {
                e.printStackTrace();
                callbackContext.error(e.toString());
              }
              break;
            case "get-webkit-info":
              getWebkitInfo(callbackContext);
              break;
            case "file-action":
              fileAction(arg1, arg2, arg3, arg4, callbackContext);
              break;
            case "is-powersave-mode":
              isPowerSaveMode(callbackContext);
              break;
            case "get-app-info":
              getAppInfo(callbackContext);
              break;
            case "pin-file-shortcut":
              pinFileShortcut(args.optJSONObject(0), callbackContext);
              break;
            case "add-shortcut":
              addShortcut(arg1, arg2, arg3, arg4, arg5, arg6, callbackContext);
              break;
            case "remove-shortcut":
              removeShortcut(arg1, callbackContext);
              break;
            case "pin-shortcut":
              pinShortcut(arg1, callbackContext);
              break;
            case "get-android-version":
              getAndroidVersion(callbackContext);
              break;
            case "request-permissions":
              requestPermissions(args.optJSONArray(0), callbackContext);
              break;
            case "request-permission":
              requestPermission(arg1, callbackContext);
              break;
            case "has-permission":
              hasPermission(arg1, callbackContext);
              break;
            case "open-in-browser":
              openInBrowser(arg1, callbackContext);
              break;
            case "launch-app":
              launchApp(arg1, arg2, args.optJSONObject(2), callbackContext);
              break;
            case "launch-app-with-file":
              launchAppWithFile(args.optJSONObject(0), callbackContext);
              break;
            case "get-global-setting":
              getGlobalSetting(arg1, callbackContext);
              break;
            case "get-available-encodings":
              getAvailableEncodings(callbackContext);
              break;
            case "decode":
              decode(arg1, arg2, callbackContext);
              break;
            case "encode":
              encode(arg1, arg2, callbackContext);
              break;
            case "compare-file-text":
              compareFileText(arg1, arg2, arg3, callbackContext);
              break;
            case "compare-texts":
              compareTexts(arg1, arg2, callbackContext);
              break;
            case "checksumText":
              cordova.getThreadPool().execute(() -> {
                try {
                  MessageDigest digest = MessageDigest.getInstance("SHA-256");

                  byte[] hash = digest.digest(
                    args.getString(0).getBytes("UTF-8")
                  );

                  StringBuilder hexString = new StringBuilder();

                  for (byte b : hash) {
                    String hex = Integer.toHexString(0xff & b);

                    if (hex.length() == 1) hexString.append('0');

                    hexString.append(hex);
                  }

                  callbackContext.success(hexString.toString());
                } catch (Exception e) {
                  callbackContext.error(e.getMessage());
                }
              });

              break;
            default:
              break;
          }
        }
      }
    );

    return true;
  }

  private void sendLogToJavaScript(String level, String message) {
    final String js =
      "if (typeof window.log === 'function')" +
      "  window.log(" +
      JSONObject.quote(level) +
      ", " +
      JSONObject.quote(message) +
      ");" +
      "else" +
      "  console.log(" +
      JSONObject.quote(level) +
      ", " +
      JSONObject.quote(message) +
      ");";

    cordova.getActivity().runOnUiThread(() -> {
      try {
        (
          (android.webkit.WebView) webView.getEngine().getView()
        ).evaluateJavascript(js, null);
      } catch (Exception e) {
        Log.e(TAG, "Failed to send log to JavaScript: " + e.getMessage());
      }
    });
  }

  // Helper method to determine MIME type using Android's built-in MimeTypeMap
  private String getMimeTypeFromExtension(String fileName) {
    String extension = "";
    int lastDotIndex = fileName.lastIndexOf('.');
    if (lastDotIndex > 0 && lastDotIndex < fileName.length() - 1) {
      extension = fileName.substring(lastDotIndex + 1).toLowerCase();
    }

    String mimeType = MimeTypeMap.getSingleton().getMimeTypeFromExtension(
      extension
    );
    return mimeType != null ? mimeType : "application/octet-stream";
  }

  /**
   * Starts a streaming HTTP request. The response body is delivered to
   * JavaScript incrementally as raw (or base64 encoded) chunks.
   *
   * <p>Args:
   * <ol>
   *   <li>requestId - unique id used for pause/resume/cancel</li>
   *   <li>url</li>
   *   <li>options JSON object:
   *     method, headers, body, bodyIsBase64, followRedirects,
   *     connectTimeout, readTimeout, chunkSize</li>
   * </ol>
   */
  private void httpStreamStart(JSONArray args, CallbackContext callbackContext) {
    try {
      final String requestId = args.getString(0);
      final String url = args.getString(1);
      final JSONObject options = args.getJSONObject(2);

      final String method = options.optString("method", "GET");
      final JSONObject headers = options.optJSONObject("headers");
      final String body = options.isNull("body") ? null : options.optString("body");
      final boolean bodyIsBase64 = options.optBoolean("bodyIsBase64", false);
      final boolean followRedirects = options.optBoolean("followRedirects", true);
      final int connectTimeout = options.optInt("connectTimeout", 30000);
      final int readTimeout = options.optInt("readTimeout", 0);
      final int chunkSize = options.optInt("chunkSize", 0);

      StreamHttp.start(
        requestId,
        url,
        method,
        headers,
        body,
        bodyIsBase64,
        followRedirects,
        connectTimeout,
        readTimeout,
        chunkSize,
        callbackContext
      );
    } catch (Exception e) {
      callbackContext.error("Failed to start stream: " + e.getMessage());
    }
  }

  private void getConfiguration(CallbackContext callback) {
    try {
      JSONObject result = new JSONObject();
      Configuration config = context.getResources().getConfiguration();
      InputMethodManager imm = (InputMethodManager) context.getSystemService(
        Context.INPUT_METHOD_SERVICE
      );
      Method method = InputMethodManager.class.getMethod(
        "getInputMethodWindowVisibleHeight"
      );

      result.put("isAcceptingText", imm.isAcceptingText());
      result.put("keyboardHeight", method.invoke(imm));
      result.put("locale", config.locale.toString());
      result.put("fontScale", config.fontScale);
      result.put("keyboard", config.keyboard);
      result.put("keyboardHidden", config.keyboardHidden);
      result.put("hardKeyboardHidden", config.hardKeyboardHidden);
      result.put("navigationHidden", config.navigationHidden);
      result.put("navigation", config.navigation);
      result.put("orientation", config.orientation);
      callback.success(result);
    } catch (
      JSONException
      | NoSuchMethodException
      | IllegalAccessException
      | InvocationTargetException error
    ) {
      callback.error(error.toString());
    }
  }

  private void decode(
    String content, // base64 encoded string
    String charSetName,
    CallbackContext callback
  ) {
    try {
      byte[] bytes = Base64.decode(content, Base64.DEFAULT);

      if (Charset.isSupported(charSetName) == false) {
        callback.error("Charset not supported: " + charSetName);
        return;
      }

      Charset charSet = Charset.forName(charSetName);
      CharBuffer charBuffer = charSet.decode(ByteBuffer.wrap(bytes));
      String result = String.valueOf(charBuffer);
      callback.success(result);
    } catch (Exception e) {
      callback.error(e.toString());
    }
  }

  private void encode(
    String content, // string to encode
    String charSetName,
    CallbackContext callback
  ) {
    try {
      if (Charset.isSupported(charSetName) == false) {
        callback.error("Charset not supported: " + charSetName);
        return;
      }

      Charset charSet = Charset.forName(charSetName);
      ByteBuffer byteBuffer = charSet.encode(content);
      byte[] bytes = new byte[byteBuffer.remaining()];
      byteBuffer.get(bytes);
      callback.success(bytes);
    } catch (Exception e) {
      callback.error(e.toString());
    }
  }

  /**
   * Compares file content with provided text.
   * This method runs in a background thread to avoid blocking the UI.
   *
   * @param fileUri The URI of the file to read (file:// or content://)
   * @param encoding The character encoding to use when reading the file
   * @param currentText The text to compare against the file content
   * @param callback Returns 1 if texts are different, 0 if same
   */
  private void compareFileText(
    String fileUri,
    String encoding,
    String currentText,
    CallbackContext callback
  ) {
    try {
      if (fileUri == null || fileUri.isEmpty()) {
        callback.error("File URI is required");
        return;
      }

      if (encoding == null || encoding.isEmpty()) {
        encoding = "UTF-8";
      }

      if (!Charset.isSupported(encoding)) {
        callback.error("Charset not supported: " + encoding);
        return;
      }

      Uri uri = Uri.parse(fileUri);
      Charset charset = Charset.forName(encoding);
      String fileContent;

      // Handle file:// URIs
      if ("file".equalsIgnoreCase(uri.getScheme())) {
        File file = new File(uri.getPath());

        // Validate file
        if (!file.exists()) {
          callback.error("File does not exist");
          return;
        }
        if (!file.isFile()) {
          callback.error("Path is not a file");
          return;
        }
        if (!file.canRead()) {
          callback.error("File is not readable");
          return;
        }

        Path path = file.toPath();
        fileContent = new String(Files.readAllBytes(path), charset);
      } else if ("content".equalsIgnoreCase(uri.getScheme())) {
        // Handle content:// URIs (including SAF tree URIs)
        InputStream inputStream = null;
        try {
          String uriString = fileUri;
          Uri resolvedUri = uri;

          // Check if this is a SAF tree URI with :: separator
          if (uriString.contains("::")) {
            try {
              // Split into tree URI and document ID
              String[] parts = uriString.split("::", 2);
              String treeUriStr = parts[0];
              String docId = parts[1];

              // Build document URI directly from tree URI and document ID
              Uri treeUri = Uri.parse(treeUriStr);
              resolvedUri = DocumentsContract.buildDocumentUriUsingTree(
                treeUri,
                docId
              );
            } catch (Exception e) {
              callback.error(
                "SAF_FALLBACK: Invalid SAF URI format - " + e.getMessage()
              );
              return;
            }
          }

          // Try to open the resolved URI
          inputStream = context
            .getContentResolver()
            .openInputStream(resolvedUri);

          if (inputStream == null) {
            callback.error("Cannot open file");
            return;
          }

          StringBuilder sb = new StringBuilder();
          try (
            BufferedReader reader = new BufferedReader(
              new InputStreamReader(inputStream, charset)
            )
          ) {
            char[] buffer = new char[8192];
            int charsRead;
            while ((charsRead = reader.read(buffer)) != -1) {
              sb.append(buffer, 0, charsRead);
            }
          }
          fileContent = sb.toString();
        } finally {
          if (inputStream != null) {
            try {
              inputStream.close();
            } catch (IOException closeError) {
              Log.w(
                TAG,
                "Failed to close input stream while reading file.",
                closeError
              );
            }
          }
        }
      } else {
        callback.error("Unsupported URI scheme: " + uri.getScheme());
        return;
      }

      // check length first
      if (fileContent.length() != currentText.length()) {
        callback.success(1); // Changed
        return;
      }

      // Full comparison
      if (fileContent.equals(currentText)) {
        callback.success(0); // Not changed
      } else {
        callback.success(1); // Changed
      }
    } catch (Exception e) {
      callback.error(e.toString());
    }
  }

  /**
   * Compares two text strings.
   * This method runs in a background thread to avoid blocking the UI
   * for large string comparisons.
   *
   * @param text1 First text to compare
   * @param text2 Second text to compare
   * @param callback Returns 1 if texts are different, 0 if same
   */
  private void compareTexts(
    String text1,
    String text2,
    CallbackContext callback
  ) {
    try {
      if (text1 == null) text1 = "";
      if (text2 == null) text2 = "";

      // check length first
      if (text1.length() != text2.length()) {
        callback.success(1); // Changed
        return;
      }

      // Full comparison
      if (text1.equals(text2)) {
        callback.success(0); // Not changed
      } else {
        callback.success(1); // Changed
      }
    } catch (Exception e) {
      callback.error(e.toString());
    }
  }

  private void getAvailableEncodings(CallbackContext callback) {
    try {
      Map<String, Charset> charsets = Charset.availableCharsets();
      JSONObject result = new JSONObject();
      for (Map.Entry<String, Charset> entry : charsets.entrySet()) {
        JSONObject obj = new JSONObject();
        Charset charset = entry.getValue();
        obj.put("label", charset.displayName());
        obj.put("aliases", new JSONArray(charset.aliases()));
        obj.put("name", charset.name());
        result.put(charset.name(), obj);
      }
      callback.success(result);
    } catch (Exception e) {
      callback.error(e.toString());
    }
  }

  private void requestPermissions(JSONArray arr, CallbackContext callback) {
    try {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
        int[] res = new int[arr.length()];
        for (int i = 0; i < res.length; ++i) {
          res[i] = 1;
        }
        callback.success(1);
        return;
      }

      String[] permissions = checkPermissions(arr);

      if (permissions.length > 0) {
        requestPermissionCallback = callback;
        cordova.requestPermissions(this, REQ_PERMISSIONS, permissions);
        return;
      }
      callback.success(new JSONArray());
    } catch (Exception e) {
      callback.error(e.toString());
    }
  }

  private void requestPermission(String permission, CallbackContext callback) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
      callback.success(1);
      return;
    }

    if (permission != null || !permission.equals("")) {
      if (!cordova.hasPermission(permission)) {
        requestPermissionCallback = callback;
        cordova.requestPermission(this, REQ_PERMISSION, permission);
        return;
      }

      callback.success(1);
      return;
    }

    callback.error("No permission passed to request.");
  }

  private void hasPermission(String permission, CallbackContext callback) {
    if (permission != null || !permission.equals("")) {
      int res = 0;
      if (cordova.hasPermission(permission)) {
        res = 1;
      }

      callback.success(res);
      return;
    }
    callback.error("No permission passed to check.");
  }

  public boolean fileExists(String path, String countSymlinks) {
    boolean countSymbolicLinks = Boolean.parseBoolean(countSymlinks);
    File file = new File(path);

    // Android < O does not implement File#toPath(), fall back to legacy checks
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      return file.exists();
    }

    Path p = file.toPath();
    try {
      if (countSymbolicLinks) {
        return Files.exists(p, LinkOption.NOFOLLOW_LINKS);
      }
      return Files.exists(p);
    } catch (Exception e) {
      return false;
    }
  }

  public boolean createSymlink(String target, String linkPath) {
    try {
      Process process = Runtime.getRuntime().exec(new String[] {
        "ln",
        "-s",
        target,
        linkPath,
      });
      return process.waitFor() == 0;
    } catch (Exception e) {
      return false;
    }
  }

  public String getNativeLibraryPath() {
    ApplicationInfo appInfo = context.getApplicationInfo();
    return appInfo.nativeLibraryDir;
  }

  public String getFilesDir() {
    return context.getFilesDir().getAbsolutePath();
  }

  public String getParentPath(String path) {
    File file = new File(path);
    File parent = file.getParentFile();
    return parent != null ? parent.getAbsolutePath() : null;
  }

  public JSONArray listChildren(String path) throws JSONException {
    File dir = new File(path);
    JSONArray result = new JSONArray();
    if (dir.exists() && dir.isDirectory()) {
      File[] files = dir.listFiles();
      if (files != null) {
        for (File file : files) {
          result.put(file.getAbsolutePath());
        }
      }
    }
    return result;
  }

  public void onRequestPermissionResult(
    int code,
    String[] permissions,
    int[] resCodes
  ) {
    if (requestPermissionCallback == null) return;

    if (code == REQ_PERMISSIONS) {
      JSONArray resAr = new JSONArray();
      for (int res : resCodes) {
        if (res == PackageManager.PERMISSION_DENIED) {
          resAr.put(0);
        }
        resAr.put(1);
      }

      requestPermissionCallback.success(resAr);
      requestPermissionCallback = null;
      return;
    }

    if (
      resCodes.length >= 1 && resCodes[0] == PackageManager.PERMISSION_DENIED
    ) {
      requestPermissionCallback.success(0);
      requestPermissionCallback = null;
      return;
    }
    requestPermissionCallback.success(1);
    requestPermissionCallback = null;
    return;
  }

  private String[] checkPermissions(JSONArray arr) throws Exception {
    List<String> list = new ArrayList<String>();
    for (int i = 0; i < arr.length(); i++) {
      try {
        String permission = arr.getString(i);
        if (permission == null || permission.equals("")) {
          throw new Exception("Permission cannot be null or empty");
        }
        if (!cordova.hasPermission(permission)) {
          list.add(permission);
        }
      } catch (JSONException e) {
        Log.w(TAG, "Invalid permission entry at index " + i, e);
      }
    }

    String[] res = new String[list.size()];
    return list.toArray(res);
  }

  private void getAndroidVersion(CallbackContext callback) {
    callback.success(Build.VERSION.SDK_INT);
  }

  private void getWebkitInfo(CallbackContext callback) {
    PackageInfo info = null;
    JSONObject res = new JSONObject();

    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        info = WebView.getCurrentWebViewPackage();
      } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
        Class webViewFactory = Class.forName("android.webkit.WebViewFactory");
        Method method = webViewFactory.getMethod("getLoadedPackageInfo");
        info = (PackageInfo) method.invoke(null);
      } else {
        PackageManager packageManager = activity.getPackageManager();

        try {
          info = packageManager.getPackageInfo("com.google.android.webview", 0);
        } catch (PackageManager.NameNotFoundException e) {
          callback.error("Package not found");
        }

        return;
      }

      res.put("packageName", info.packageName);
      res.put("versionName", info.versionName);
      res.put("versionCode", info.versionCode);

      callback.success(res);
    } catch (
      JSONException
      | InvocationTargetException
      | ClassNotFoundException
      | NoSuchMethodException
      | IllegalAccessException e
    ) {
      callback.error(
        "Cannot determine current WebView engine. (" + e.getMessage() + ")"
      );

      return;
    }
  }

  private void isPowerSaveMode(CallbackContext callback) {
    PowerManager powerManager = (PowerManager) context.getSystemService(
      Context.POWER_SERVICE
    );
    boolean powerSaveMode = powerManager.isPowerSaveMode();

    callback.success(powerSaveMode ? 1 : 0);
  }

  private void pinFileShortcut(
    JSONObject shortcutJson,
    CallbackContext callback
  ) {
    if (shortcutJson == null) {
      callback.error("Invalid shortcut data");
      return;
    }

    String id = shortcutJson.optString("id", "");
    String label = shortcutJson.optString("label", "");
    String description = shortcutJson.optString("description", label);
    String iconSrc = shortcutJson.optString("icon", "");
    String uriString = shortcutJson.optString("uri", "");

    if (id.isEmpty() || label.isEmpty() || uriString.isEmpty()) {
      callback.error("Missing required shortcut fields");
      return;
    }

    if (!ShortcutManagerCompat.isRequestPinShortcutSupported(context)) {
      callback.error("Pin shortcut not supported on this launcher");
      return;
    }

    try {
      Uri dataUri = Uri.parse(uriString);
      String packageName = context.getPackageName();
      PackageManager pm = context.getPackageManager();

      Intent launchIntent = pm.getLaunchIntentForPackage(packageName);
      if (launchIntent == null) {
        callback.error("Launch intent not found for package: " + packageName);
        return;
      }

      ComponentName componentName = launchIntent.getComponent();
      if (componentName == null) {
        callback.error("ComponentName is null");
        return;
      }

      Intent intent = new Intent(Intent.ACTION_VIEW);
      intent.setComponent(componentName);
      intent.setData(dataUri);
      intent.putExtra("acodeFileUri", uriString);

      IconCompat icon;

      if (iconSrc != null && !iconSrc.isEmpty()) {
        try {
          Uri iconUri = Uri.parse(iconSrc);
          Bitmap bitmap;

          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            // API 28+
            ImageDecoder.Source source = ImageDecoder.createSource(
              context.getContentResolver(),
              iconUri
            );
            bitmap = ImageDecoder.decodeBitmap(source);
          } else {
            // Below API 28
            bitmap = MediaStore.Images.Media.getBitmap(
              context.getContentResolver(),
              iconUri
            );
          }

          icon = IconCompat.createWithBitmap(bitmap);
        } catch (Exception e) {
          icon = getFileShortcutIcon(label);
        }
      } else {
        icon = getFileShortcutIcon(label);
      }

      ShortcutInfoCompat shortcut = new ShortcutInfoCompat.Builder(context, id)
        .setShortLabel(label)
        .setLongLabel(
          description != null && !description.isEmpty() ? description : label
        )
        .setIcon(icon)
        .setIntent(intent)
        .build();

      ShortcutManagerCompat.pushDynamicShortcut(context, shortcut);

      boolean requested = ShortcutManagerCompat.requestPinShortcut(
        context,
        shortcut,
        null
      );

      if (!requested) {
        callback.error("Failed to request pin shortcut");
        return;
      }

      callback.success();
    } catch (Exception e) {
      callback.error(e.toString());
    }
  }

  private IconCompat getFileShortcutIcon(String filename) {
    Bitmap fallback = createFileShortcutBitmap(filename);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      return IconCompat.createWithAdaptiveBitmap(fallback);
    }
    return IconCompat.createWithBitmap(fallback);
  }

  private Bitmap createFileShortcutBitmap(String filename) {
    final float baseSizeDp = 72f;
    float sizePx = TypedValue.applyDimension(
      TypedValue.COMPLEX_UNIT_DIP,
      baseSizeDp,
      context.getResources().getDisplayMetrics()
    );
    if (sizePx <= 0) {
      sizePx = baseSizeDp;
    }
    int size = Math.round(sizePx);
    Bitmap bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
    Canvas canvas = new Canvas(bitmap);
    Paint paint = new Paint(
      Paint.ANTI_ALIAS_FLAG | Paint.DITHER_FLAG | Paint.FILTER_BITMAP_FLAG
    );

    int backgroundColor = pickShortcutColor(filename);
    paint.setColor(backgroundColor);
    float radius = size * 0.24f;
    RectF bounds = new RectF(0, 0, size, size);
    canvas.drawRoundRect(bounds, radius, radius, paint);

    paint.setColor(Color.WHITE);
    paint.setTextAlign(Paint.Align.CENTER);
    paint.setTypeface(Typeface.create("sans-serif-medium", Typeface.BOLD));

    String label = getShortcutLabel(filename);
    float textLength = Math.max(1, label.length());
    float factor = textLength > 4 ? 0.22f : textLength > 3 ? 0.26f : 0.34f;
    paint.setTextSize(size * factor);
    Paint.FontMetrics metrics = paint.getFontMetrics();
    float baseline = (size - metrics.bottom - metrics.top) / 2f;
    canvas.drawText(label, size / 2f, baseline, paint);

    return bitmap;
  }

  private String getFileExtension(String filename) {
    if (filename == null) return "";
    int dot = filename.lastIndexOf('.');
    if (dot < 0 || dot == filename.length() - 1) return "";
    return filename.substring(dot + 1).toLowerCase(Locale.getDefault());
  }

  private String getShortcutLabel(String filename) {
    String ext = getFileExtension(filename);
    if (!ext.isEmpty()) {
      switch (ext) {
        case "js":
        case "jsx":
          return "JS";
        case "ts":
        case "tsx":
          return "TS";
        case "md":
        case "markdown":
          return "MD";
        case "json":
          return "JSON";
        case "html":
        case "htm":
          return "HTML";
        case "css":
          return "CSS";
        case "java":
          return "JAVA";
        case "kt":
        case "kts":
          return "KOT";
        case "py":
          return "PY";
        case "rb":
          return "RB";
        case "c":
          return "C";
        case "cpp":
        case "cc":
        case "cxx":
          return "CPP";
        case "h":
        case "hpp":
          return "HDR";
        case "go":
          return "GO";
        case "rs":
          return "RS";
        case "php":
          return "PHP";
        case "xml":
          return "XML";
        case "yml":
        case "yaml":
          return "YML";
        case "txt":
          return "TXT";
        case "sh":
        case "bash":
          return "SH";
        default:
          String label = ext.replaceAll("[^A-Za-z0-9]", "");
          if (label.isEmpty()) label = ext;
          if (label.length() > 4) {
            label = label.substring(0, 4);
          }
          return label.toUpperCase(Locale.getDefault());
      }
    }

    if (filename != null && !filename.trim().isEmpty()) {
      String cleaned = filename.replaceAll("[^A-Za-z0-9]", "");
      if (!cleaned.isEmpty()) {
        if (cleaned.length() > 3) cleaned = cleaned.substring(0, 3);
        return cleaned.toUpperCase(Locale.getDefault());
      }
      return filename.substring(0, 1).toUpperCase(Locale.getDefault());
    }

    return "FILE";
  }

  private int pickShortcutColor(String filename) {
    String ext = getFileExtension(filename);
    switch (ext) {
      case "js":
      case "jsx":
        return 0xFFF7DF1E;
      case "ts":
      case "tsx":
        return 0xFF3178C6;
      case "md":
      case "markdown":
        return 0xFF546E7A;
      case "json":
        return 0xFF4CAF50;
      case "html":
      case "htm":
        return 0xFFF4511E;
      case "css":
        return 0xFF2962FF;
      case "java":
        return 0xFFEC6F2D;
      case "kt":
      case "kts":
        return 0xFF7F52FF;
      case "py":
        return 0xFF306998;
      case "rb":
        return 0xFFCC342D;
      case "c":
        return 0xFF546E7A;
      case "cpp":
      case "cc":
      case "cxx":
        return 0xFF00599C;
      case "h":
      case "hpp":
        return 0xFF8D6E63;
      case "go":
        return 0xFF00ADD8;
      case "rs":
        return 0xFFB7410E;
      case "php":
        return 0xFF8892BF;
      case "xml":
        return 0xFF5C6BC0;
      case "yml":
      case "yaml":
        return 0xFF757575;
      case "txt":
        return 0xFF546E7A;
      case "sh":
      case "bash":
        return 0xFF388E3C;
      default:
        final int[] colors = new int[] {
          0xFF1E88E5,
          0xFF6D4C41,
          0xFF00897B,
          0xFF8E24AA,
          0xFF3949AB,
          0xFF039BE5,
          0xFFD81B60,
          0xFF43A047,
        };
        String key = ext.isEmpty()
          ? (filename == null ? "file" : filename)
          : ext;
        int hash = Math.abs(key.hashCode());
        return colors[hash % colors.length];
    }
  }

  private void fileAction(
    String fileURI,
    String filename,
    String action,
    String mimeType,
    CallbackContext callback
  ) {
    Activity activity = this.activity;
    Context context = this.context;
    Uri uri = this.getContentProviderUri(fileURI, filename);
    if (uri == null) {
      callback.error("Unable to access file for action " + action);
      return;
    }
    try {
      Intent intent = new Intent(action);

      if (mimeType.equals("")) {
        mimeType = "text/plain";
      }

      mimeType = resolveMimeType(mimeType, uri, filename);

      String clipLabel = null;
      if (filename != null && !filename.isEmpty()) {
        clipLabel = new File(filename).getName();
      }
      if (clipLabel == null || clipLabel.isEmpty()) {
        clipLabel = uri.getLastPathSegment();
      }
      if (clipLabel == null || clipLabel.isEmpty()) {
        clipLabel = "shared-file";
      }
      if (action.equals(Intent.ACTION_SEND)) {
        intent.setType(mimeType);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        intent.setClipData(
          ClipData.newUri(context.getContentResolver(), clipLabel, uri)
        );
        intent.putExtra(Intent.EXTRA_STREAM, uri);
        intent.putExtra(Intent.EXTRA_TITLE, clipLabel);
        intent.putExtra(Intent.EXTRA_SUBJECT, clipLabel);
        if (filename != null && !filename.isEmpty()) {
          intent.putExtra(Intent.EXTRA_TEXT, filename);
        }
      } else {
        int flags =
          Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION |
          Intent.FLAG_GRANT_READ_URI_PERMISSION;

        if (action.equals(Intent.ACTION_EDIT)) {
          flags |= Intent.FLAG_GRANT_WRITE_URI_PERMISSION;
        }

        intent.setFlags(flags);
        intent.setDataAndType(uri, mimeType);
        intent.setClipData(
          ClipData.newUri(context.getContentResolver(), clipLabel, uri)
        );
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        if (!clipLabel.equals("shared-file")) {
          intent.putExtra(Intent.EXTRA_TITLE, clipLabel);
        }
        if (action.equals(Intent.ACTION_EDIT)) {
          intent.putExtra(Intent.EXTRA_STREAM, uri);
        }
      }

      int permissionFlags = Intent.FLAG_GRANT_READ_URI_PERMISSION;
      if (action.equals(Intent.ACTION_EDIT)) {
        permissionFlags |= Intent.FLAG_GRANT_WRITE_URI_PERMISSION;
      }
      grantUriPermissions(intent, uri, permissionFlags);

      if (action.equals(Intent.ACTION_SEND)) {
        Intent chooserIntent = Intent.createChooser(intent, null);
        chooserIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        activity.startActivity(chooserIntent);
      } else if (
        action.equals(Intent.ACTION_EDIT) || action.equals(Intent.ACTION_VIEW)
      ) {
        Intent chooserIntent = Intent.createChooser(intent, null);
        chooserIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        if (action.equals(Intent.ACTION_EDIT)) {
          chooserIntent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        }
        activity.startActivity(chooserIntent);
      } else {
        activity.startActivity(intent);
      }
      callback.success(uri.toString());
    } catch (Exception e) {
      callback.error(e.getMessage());
    }
  }

  private void getAppInfo(CallbackContext callback) {
    JSONObject res = new JSONObject();
    try {
      PackageManager pm = activity.getPackageManager();
      PackageInfo pInfo = pm.getPackageInfo(context.getPackageName(), 0);
      ApplicationInfo appInfo = context.getApplicationInfo();
      int isDebuggable = appInfo.flags & ApplicationInfo.FLAG_DEBUGGABLE;

      res.put("firstInstallTime", pInfo.firstInstallTime);
      res.put("lastUpdateTime", pInfo.lastUpdateTime);
      res.put("label", appInfo.loadLabel(pm).toString());
      res.put("packageName", pInfo.packageName);
      res.put("versionName", pInfo.versionName);
      res.put("versionCode", pInfo.getLongVersionCode());
      res.put("isDebuggable", isDebuggable);

      callback.success(res);
    } catch (JSONException e) {
      callback.error(e.getMessage());
    } catch (Exception e) {
      callback.error(e.getMessage());
    }
  }

  private void openInBrowser(String src, CallbackContext callback) {
    if (src == null || src.isEmpty()) {
      callback.error("No URL provided.");
      return;
    }

    Uri uri = Uri.parse(src);
    if ("file".equalsIgnoreCase(uri.getScheme())) {
      // file:// URIs can't leave the app (FileUriExposedException).
      callback.error("Cannot open file URI in browser: " + src);
      return;
    }

    try {
      Intent browserIntent = new Intent(Intent.ACTION_VIEW, uri);
      activity.startActivity(browserIntent);
      callback.success();
    } catch (Exception e) {
      Log.e("System", "Failed to open URL: " + src, e);
      callback.error(e.getMessage());
    }
  }

  private void launchApp(
    String appId,
    String className,
    JSONObject extras,
    CallbackContext callback
  ) {
    if (appId == null || appId.equals("")) {
      callback.error("No package name provided.");
      return;
    }

    if (className == null || className.equals("")) {
      callback.error("No activity class name provided.");
      return;
    }

    try {
      Intent intent = new Intent(Intent.ACTION_MAIN);
      intent.addCategory(Intent.CATEGORY_LAUNCHER);
      intent.setPackage(appId);
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      intent.setClassName(appId, className);

      applyExtras(intent, extras);

      activity.startActivity(intent);
      callback.success("Launched " + appId);
    } catch (Exception e) {
      callback.error(e.toString());
    }
  }

  /**
   * Copies caller supplied JSON key/value pairs onto an intent as extras,
   * preserving the scalar type of every value.
   */
  private void applyExtras(Intent intent, JSONObject extras)
    throws JSONException {
    if (extras == null) {
      return;
    }

    Iterator<String> keys = extras.keys();

    while (keys.hasNext()) {
      String key = keys.next();
      putScalarExtra(intent, key, extras.get(key));
    }
  }

  /**
   * Puts one JSON scalar on the intent through the matching typed overload, so
   * the receiving app sees a primitive rather than a stringified value.
   */
  private void putScalarExtra(Intent intent, String key, Object value) {
    if (value instanceof Integer) {
      intent.putExtra(key, (Integer) value);
    } else if (value instanceof Boolean) {
      intent.putExtra(key, (Boolean) value);
    } else if (value instanceof Double) {
      intent.putExtra(key, (Double) value);
    } else if (value instanceof Long) {
      intent.putExtra(key, (Long) value);
    } else if (value instanceof String) {
      intent.putExtra(key, (String) value);
    } else {
      intent.putExtra(key, value.toString());
    }
  }

  /**
   * Like {@link #applyExtras}, but maps JSON arrays onto typed arrays instead
   * of stringifying them.
   *
   * Only the file launch API uses this, so {@code launchApp} keeps turning
   * array extras into strings exactly as it always has.
   */
  private void applyRichExtras(Intent intent, JSONObject extras)
    throws JSONException {
    if (extras == null) {
      return;
    }

    Iterator<String> keys = extras.keys();

    while (keys.hasNext()) {
      String key = keys.next();
      Object value = extras.get(key);

      if (value instanceof JSONArray) {
        putArrayExtra(intent, key, (JSONArray) value);
      } else {
        putScalarExtra(intent, key, value);
      }
    }
  }

  private void putArrayExtra(Intent intent, String key, JSONArray array) {
    int length = array.length();

    if (length == 0) {
      intent.putExtra(key, new String[0]);
      return;
    }

    boolean allBooleans = true;
    boolean allIntegral = true;
    boolean allNumbers = true;
    boolean needsLong = false;

    for (int i = 0; i < length; i++) {
      Object item = array.opt(i);
      if (!(item instanceof Boolean)) {
        allBooleans = false;
      }
      if (!(item instanceof Integer) && !(item instanceof Long)) {
        allIntegral = false;
      }
      if (item instanceof Long) {
        long value = (Long) item;
        if (value < Integer.MIN_VALUE || value > Integer.MAX_VALUE) {
          needsLong = true;
        }
      }
      if (!(item instanceof Number)) {
        allNumbers = false;
      }
    }

    if (allBooleans) {
      boolean[] values = new boolean[length];
      for (int i = 0; i < length; i++) {
        values[i] = (Boolean) array.opt(i);
      }
      intent.putExtra(key, values);
      return;
    }

    if (allIntegral) {
      // Values outside the 32-bit range must survive as long[], otherwise e.g.
      // 4294967296 would silently arrive as 0.
      if (needsLong) {
        long[] values = new long[length];
        for (int i = 0; i < length; i++) {
          values[i] = ((Number) array.opt(i)).longValue();
        }
        intent.putExtra(key, values);
        return;
      }

      int[] values = new int[length];
      for (int i = 0; i < length; i++) {
        values[i] = ((Number) array.opt(i)).intValue();
      }
      intent.putExtra(key, values);
      return;
    }

    if (allNumbers) {
      double[] values = new double[length];
      for (int i = 0; i < length; i++) {
        values[i] = ((Number) array.opt(i)).doubleValue();
      }
      intent.putExtra(key, values);
      return;
    }

    String[] values = new String[length];
    for (int i = 0; i < length; i++) {
      values[i] = String.valueOf(array.opt(i));
    }
    intent.putExtra(key, values);
  }

  /**
   * Launches an activity and hands it content URIs for files owned by this app.
   *
   * This is the union of {@link #launchApp} (chosen package + activity) and
   * {@link #fileAction} (shareable content URIs): the caller picks the target
   * instead of the system chooser, and the receiving activity is granted read
   * (and optionally write) access to the content URIs.
   *
   * Versatility rules, all optional:
   * - no {@code className}: the best matching activity in {@code app} is resolved.
   * - no {@code app}: the intent stays implicit, so the system picks the handler.
   * - several files: the default action becomes {@code SEND_MULTIPLE}.
   * - no files: the default action becomes {@code MAIN}, i.e. a plain app launch.
   */
  private void launchAppWithFile(JSONObject options, CallbackContext callback) {
    if (options == null) {
      callback.error("No options provided.");
      return;
    }

    String appId = trimToEmpty(options.optString("app", ""));
    String className = trimToEmpty(options.optString("className", ""));
    String filename = trimToEmpty(options.optString("filename", ""));

    if (!className.isEmpty() && appId.isEmpty()) {
      callback.error("\"className\" requires \"app\" (the package name).");
      return;
    }

    List<Uri> uris = collectFileUris(options, filename);
    if (uris == null) {
      callback.error("Unable to access one or more files to pass on.");
      return;
    }

    if (uris.isEmpty() && appId.isEmpty()) {
      callback.error("Nothing to launch: provide \"app\" and/or a file.");
      return;
    }

    String requestedAction = trimToEmpty(options.optString("action", ""));
    String intentAction = requestedAction.isEmpty()
      ? defaultIntentAction(uris.size())
      : normalizeIntentAction(requestedAction);

    String requestedMime = trimToEmpty(options.optString("mimeType", ""));
    String clipLabel = trimToEmpty(options.optString("clipLabel", ""));
    boolean newTask = options.optBoolean("newTask", true);
    boolean attachAsStream = options.optBoolean("attachAsStream", false);
    boolean writeAccess =
      options.optBoolean("writeAccess", false) ||
      Intent.ACTION_EDIT.equals(intentAction);

    Uri primary = uris.isEmpty() ? null : uris.get(0);

    // A multi-file send advertises one type for the whole set, so use the type
    // every file shares. A content:// URI from another app can also be
    // unreadable here, which makes getType() throw; that must not abort.
    String mimeType;
    try {
      mimeType = resolveCommonMimeType(requestedMime, uris, filename);
    } catch (RuntimeException error) {
      Log.w(TAG, "Unable to resolve MIME type, falling back to */*", error);
      mimeType = "*/*";
    }

    int grantFlags = Intent.FLAG_GRANT_READ_URI_PERMISSION;
    if (writeAccess) {
      grantFlags |= Intent.FLAG_GRANT_WRITE_URI_PERMISSION;
    }

    try {
      Intent intent = new Intent(intentAction);

      if (newTask) {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      }

      if (primary != null) {
        if (Intent.ACTION_SEND_MULTIPLE.equals(intentAction)) {
          intent.setType(mimeType);
          intent.putParcelableArrayListExtra(
            Intent.EXTRA_STREAM,
            new ArrayList<>(uris)
          );
        } else if (Intent.ACTION_SEND.equals(intentAction)) {
          intent.setType(mimeType);
          intent.putExtra(Intent.EXTRA_STREAM, primary);
        } else {
          intent.setDataAndType(primary, mimeType);
          if (attachAsStream) {
            intent.putExtra(Intent.EXTRA_STREAM, primary);
          }
        }
      } else if (!requestedMime.isEmpty()) {
        intent.setType(mimeType);
      }

      // A plain app launch is a launcher launch: MAIN + LAUNCHER. The launcher
      // category is implied only when the caller supplied no categories, since
      // the binding always sends an array (possibly empty) for "not given".
      JSONArray categories = options.optJSONArray("categories");
      boolean hasCategories = categories != null && categories.length() > 0;
      boolean launcherLaunch =
        primary == null && Intent.ACTION_MAIN.equals(intentAction);

      if (launcherLaunch && !hasCategories) {
        intent.addCategory(Intent.CATEGORY_LAUNCHER);
      }

      applyCategories(intent, categories);

      if (!appId.isEmpty()) {
        intent.setPackage(appId);

        if (!className.isEmpty()) {
          intent.setClassName(appId, className);
        } else if (launcherLaunch && !hasCategories) {
          pinLaunchActivity(intent, appId);
        } else {
          // Best effort only. On Android 11+ package visibility can hide an
          // installed handler from resolveActivity, and this app declares no
          // <queries>, while the system can still dispatch to it. So a miss
          // here must never block the launch: setPackage alone is enough.
          resolveComponentInPackage(intent);
        }
      }

      if (primary != null) {
        // ClipData carries the grant over to the data URI on older releases and
        // keeps every file visible to the target as a shared item.
        intent.setClipData(
          buildClipData(
            uris,
            clipLabel.isEmpty() ? getClipLabel(primary, filename) : clipLabel
          )
        );
        intent.addFlags(grantFlags);
      }

      applyRichExtras(intent, options.optJSONObject("extras"));

      String flagError = applyFlags(intent, options.optJSONArray("flags"));
      if (flagError != null) {
        callback.error(flagError);
        return;
      }

      if (primary != null && !appId.isEmpty()) {
        // Grant only the package the caller named. For an implicit launch the
        // read/write flag on the intent plus its ClipData is what carries the
        // grant, and the system applies it to the receiver the user actually
        // picks. Granting to every query result instead would hand read (or
        // write) access to apps the user never chooses.
        grantUriPermissionsToPackage(appId, uris, grantFlags);
      }

      activity.startActivity(intent);

      callback.success(buildLaunchResult(intent, intentAction, mimeType, uris));
    } catch (ActivityNotFoundException notFound) {
      callback.error(
        className.isEmpty()
          ? "No activity found to handle " +
            intentAction +
            " for " +
            mimeType +
            (appId.isEmpty()
              ? "."
              : " in " +
                appId +
                ". Pass \"className\" to target one explicitly.")
          : "No activity " + className + " found in package " + appId + "."
      );
    } catch (Exception e) {
      callback.error(e.toString());
    }
  }

  private static String defaultIntentAction(int fileCount) {
    if (fileCount > 1) {
      return Intent.ACTION_SEND_MULTIPLE;
    }

    return fileCount == 1 ? Intent.ACTION_VIEW : Intent.ACTION_MAIN;
  }

  /**
   * Resolves every requested file to a shareable content URI, in request order.
   *
   * @return the URIs, or null when any requested file cannot be exposed.
   */
  private List<Uri> collectFileUris(JSONObject options, String filename) {
    List<Uri> uris = new ArrayList<>();
    String single = trimToEmpty(options.optString("fileUri", ""));

    if (!single.isEmpty()) {
      Uri uri = getContentProviderUri(single, filename);
      if (uri == null) {
        return null;
      }
      uris.add(uri);
    }

    JSONArray many = options.optJSONArray("fileUris");

    if (many != null) {
      for (int i = 0; i < many.length(); i++) {
        String entry = trimToEmpty(many.optString(i));
        if (entry.isEmpty()) {
          continue;
        }

        Uri uri = getContentProviderUri(entry, filename);
        if (uri == null) {
          return null;
        }

        if (!uris.contains(uri)) {
          uris.add(uri);
        }
      }
    }

    return uris;
  }

  /**
   * Pins the launcher activity of {@code appId} for a plain app launch.
   *
   * A launcher filter normally declares only MAIN and LAUNCHER, so it can never
   * match a MATCH_DEFAULT_ONLY lookup. getLaunchIntentForPackage is the
   * launcher-specific lookup Android provides for exactly this case. When
   * package visibility hides the package it returns null, and the MAIN+LAUNCHER
   * intent is still dispatched by the system, so this is an optimisation.
   */
  private void pinLaunchActivity(Intent intent, String appId) {
    Intent launch = context.getPackageManager().getLaunchIntentForPackage(appId);
    ComponentName component = launch == null ? null : launch.getComponent();

    if (component != null) {
      intent.setClassName(
        component.getPackageName(),
        component.getClassName()
      );
      return;
    }

    resolveComponentInPackage(intent);
  }

  /**
   * Pins the component only when Android lets us see it. This is an
   * optimisation that makes the resolved receiver visible in the result; the
   * launch itself never depends on it, because package visibility on Android
   * 11+ can hide an installed handler from resolveActivity while the system
   * can still dispatch to it.
   *
   * Nothing is guessed here: a miss leaves the intent package-scoped, so a
   * failed file hand-off can never silently open the app's home screen.
   */
  private void resolveComponentInPackage(Intent intent) {
    PackageManager pm = context.getPackageManager();
    ResolveInfo resolved = pm.resolveActivity(
      intent,
      PackageManager.MATCH_DEFAULT_ONLY
    );

    if (resolved != null && resolved.activityInfo != null) {
      intent.setClassName(
        resolved.activityInfo.packageName,
        resolved.activityInfo.name
      );
    }
  }

  private void applyCategories(Intent intent, JSONArray categories) {
    if (categories == null) {
      return;
    }

    for (int i = 0; i < categories.length(); i++) {
      String name = trimToEmpty(categories.optString(i));
      if (name.isEmpty()) {
        continue;
      }
      intent.addCategory(normalizeCategoryName(name));
    }
  }

  private static String normalizeCategoryName(String name) {
    if (name.indexOf('.') >= 0) {
      return name;
    }

    String upper = name.toUpperCase(Locale.US);

    switch (upper) {
      case "DEFAULT":
        return Intent.CATEGORY_DEFAULT;
      case "LAUNCHER":
        return Intent.CATEGORY_LAUNCHER;
      case "BROWSABLE":
        return Intent.CATEGORY_BROWSABLE;
      case "OPENABLE":
        return Intent.CATEGORY_OPENABLE;
      case "HOME":
        return Intent.CATEGORY_HOME;
      case "PREFERENCE":
        return Intent.CATEGORY_PREFERENCE;
      case "LEANBACK_LAUNCHER":
        return Intent.CATEGORY_LEANBACK_LAUNCHER;
      default:
        return "android.intent.category." + upper;
    }
  }

  /**
   * Adds caller supplied intent flags, accepting readable names, raw constants
   * and plain integers.
   *
   * @return null on success, or a message naming every unknown flag.
   */
  private String applyFlags(Intent intent, JSONArray flags) {
    if (flags == null) {
      return null;
    }

    StringBuilder unknown = new StringBuilder();

    for (int i = 0; i < flags.length(); i++) {
      Object entry = flags.opt(i);

      if (entry == null || entry == JSONObject.NULL) {
        continue;
      }

      if (entry instanceof Number) {
        intent.addFlags(((Number) entry).intValue());
        continue;
      }

      String name = trimToEmpty(String.valueOf(entry));
      if (name.isEmpty()) {
        continue;
      }

      Integer flag = intentFlagFor(normalizeFlagName(name));

      if (flag == null) {
        if (unknown.length() > 0) {
          unknown.append(", ");
        }
        unknown.append(name);
      } else {
        intent.addFlags(flag);
      }
    }

    return unknown.length() == 0
      ? null
      : "Unknown intent flag(s): " + unknown;
  }

  private static String normalizeFlagName(String name) {
    String normalized = trimToEmpty(name).toUpperCase(Locale.US);

    if (normalized.startsWith("FLAG_")) {
      normalized = normalized.substring(5);
    }

    if (normalized.startsWith("ACTIVITY_")) {
      normalized = normalized.substring(9);
    }

    return normalized;
  }

  /**
   * Maps a readable flag name onto the matching {@link Intent} constant.
   */
  private static Integer intentFlagFor(String name) {
    switch (name) {
      case "NEW_TASK":
        return Intent.FLAG_ACTIVITY_NEW_TASK;
      case "SINGLE_TOP":
        return Intent.FLAG_ACTIVITY_SINGLE_TOP;
      case "CLEAR_TOP":
        return Intent.FLAG_ACTIVITY_CLEAR_TOP;
      case "CLEAR_TASK":
        return Intent.FLAG_ACTIVITY_CLEAR_TASK;
      case "MULTIPLE_TASK":
        return Intent.FLAG_ACTIVITY_MULTIPLE_TASK;
      case "NEW_DOCUMENT":
        return Intent.FLAG_ACTIVITY_NEW_DOCUMENT;
      case "NO_HISTORY":
        return Intent.FLAG_ACTIVITY_NO_HISTORY;
      case "NO_ANIMATION":
        return Intent.FLAG_ACTIVITY_NO_ANIMATION;
      case "EXCLUDE_FROM_RECENTS":
        return Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS;
      case "REORDER_TO_FRONT":
        return Intent.FLAG_ACTIVITY_REORDER_TO_FRONT;
      case "TASK_ON_HOME":
        return Intent.FLAG_ACTIVITY_TASK_ON_HOME;
      case "RESET_TASK_IF_NEEDED":
        return Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED;
      case "GRANT_READ_URI_PERMISSION":
        return Intent.FLAG_GRANT_READ_URI_PERMISSION;
      case "GRANT_WRITE_URI_PERMISSION":
        return Intent.FLAG_GRANT_WRITE_URI_PERMISSION;
      case "GRANT_PERSISTABLE_URI_PERMISSION":
        return Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION;
      case "GRANT_PREFIX_URI_PERMISSION":
        return Intent.FLAG_GRANT_PREFIX_URI_PERMISSION;
      default:
        return null;
    }
  }

  private ClipData buildClipData(List<Uri> uris, String label) {
    ClipData clip = ClipData.newUri(
      context.getContentResolver(),
      label,
      uris.get(0)
    );

    for (int i = 1; i < uris.size(); i++) {
      clip.addItem(new ClipData.Item(uris.get(i)));
    }

    return clip;
  }

  private JSONObject buildLaunchResult(
    Intent intent,
    String action,
    String mimeType,
    List<Uri> uris
  ) throws JSONException {
    JSONArray fileUris = new JSONArray();
    for (Uri uri : uris) {
      fileUris.put(uri.toString());
    }

    // Report only a receiver we actually pinned down. For an implicit intent
    // with several handlers resolveActivity returns the system's app picker,
    // which is not the app the user ends up choosing, so report nothing.
    ComponentName component = intent.getComponent();

    JSONObject result = new JSONObject();
    result.put("action", action);
    result.put("mimeType", mimeType);
    result.put("uris", fileUris);
    result.put("uri", uris.isEmpty() ? "" : uris.get(0).toString());
    result.put(
      "component",
      component == null ? "" : component.flattenToString()
    );
    result.put("app", component == null ? "" : component.getPackageName());
    result.put(
      "className",
      component == null ? "" : component.getClassName()
    );

    return result;
  }

  private static String trimToEmpty(String value) {
    return value == null ? "" : value.trim();
  }

  private static String normalizeIntentAction(String action) {
    String normalized = trimToEmpty(action);

    if (normalized.isEmpty()) {
      return Intent.ACTION_VIEW;
    }

    if (normalized.indexOf('.') < 0) {
      return "android.intent.action." + normalized.toUpperCase(Locale.US);
    }

    return normalized;
  }

  private String getClipLabel(Uri uri, String filename) {
    String label = null;

    if (filename != null && !filename.isEmpty()) {
      label = new File(filename).getName();
    }

    if (label == null || label.isEmpty()) {
      label = uri.getLastPathSegment();
    }

    if (label == null || label.isEmpty()) {
      label = "shared-file";
    }

    return label;
  }

  /**
   * Grants every content URI to the package that will receive the intent.
   *
   * An explicit component does not have to match any intent filter, so
   * resolving the intent can legitimately come back empty; this direct grant is
   * what makes explicit-component hand-off work.
   */
  private void grantUriPermissionsToPackage(
    String targetPackage,
    List<Uri> uris,
    int flags
  ) {
    for (Uri uri : uris) {
      try {
        context.grantUriPermission(targetPackage, uri, flags);
      } catch (SecurityException error) {
        Log.w(TAG, "Unable to grant URI permission to " + targetPackage, error);
      }
    }
  }

  private void addShortcut(
    String id,
    String label,
    String description,
    String iconSrc,
    String action,
    String data,
    CallbackContext callback
  ) {
    try {
      Intent intent;
      ImageDecoder.Source imgSrc;
      Bitmap bitmap;
      IconCompat icon;

      imgSrc = ImageDecoder.createSource(
        context.getContentResolver(),
        Uri.parse(iconSrc)
      );
      bitmap = ImageDecoder.decodeBitmap(imgSrc);
      icon = IconCompat.createWithBitmap(bitmap);
      intent = activity
        .getPackageManager()
        .getLaunchIntentForPackage(activity.getPackageName());
      intent.putExtra("action", action);
      intent.putExtra("data", data);

      ShortcutInfoCompat shortcut = new ShortcutInfoCompat.Builder(context, id)
        .setShortLabel(label)
        .setLongLabel(description)
        .setIcon(icon)
        .setIntent(intent)
        .build();

      ShortcutManagerCompat.pushDynamicShortcut(context, shortcut);
      callback.success();
    } catch (Exception e) {
      callback.error(e.toString());
    }
  }

  private void pinShortcut(String id, CallbackContext callback) {
    ShortcutManager shortcutManager = context.getSystemService(
      ShortcutManager.class
    );

    if (shortcutManager.isRequestPinShortcutSupported()) {
      ShortcutInfo pinShortcutInfo = new ShortcutInfo.Builder(
        context,
        id
      ).build();

      Intent pinnedShortcutCallbackIntent =
        shortcutManager.createShortcutResultIntent(pinShortcutInfo);

      PendingIntent successCallback = PendingIntent.getBroadcast(
        context,
        0,
        pinnedShortcutCallbackIntent,
        PendingIntent.FLAG_IMMUTABLE
      );

      shortcutManager.requestPinShortcut(
        pinShortcutInfo,
        successCallback.getIntentSender()
      );

      callback.success();
      return;
    }

    callback.error("Not supported");
  }

  private void removeShortcut(String id, CallbackContext callback) {
    try {
      List<String> list = new ArrayList<String>();
      list.add(id);
      ShortcutManagerCompat.removeDynamicShortcuts(context, list);
      callback.success();
    } catch (Exception e) {
      callback.error(e.toString());
    }
  }

  private void setUiTheme(
    final String systemBarColor,
    final JSONObject scheme,
    final CallbackContext callback
  ) {
    try {
      this.systemBarColor = Color.parseColor(systemBarColor);
      this.theme = new Theme(scheme);

      preferences.set("BackgroundColor", this.systemBarColor);
      webView.getPluginManager().postMessage("updateSystemBars", null);
      applySystemBarTheme();

      if (scheme != null) {
        try {
          android.content.SharedPreferences themePrefs = activity
            .getApplicationContext()
            .getSharedPreferences("acode_theme", Context.MODE_PRIVATE);
          android.content.SharedPreferences.Editor prefEditor = themePrefs.edit();
          Iterator<String> keys = scheme.keys();
          while (keys.hasNext()) {
            String key = keys.next();
            prefEditor.putString(key, scheme.optString(key));
          }
          prefEditor.apply();
        } catch (Exception ignored) {}
      }

      callback.success();
    } catch (IllegalArgumentException e) {
      callback.error("Invalid color: " + systemBarColor);
    } catch (Exception e) {
      callback.error(e.toString());
    }
  }

  private void applySystemBarTheme() {
    final Window window = activity.getWindow();
    final View decorView = window.getDecorView();

    // Keep Cordova's BackgroundColor flow for API 36+, but also apply the
    // window colors directly so OEM variants do not leave stale system-bar
    // colors behind after a theme switch.
    window.clearFlags(0x04000000 | 0x08000000); // FLAG_TRANSLUCENT_STATUS | FLAG_TRANSLUCENT_NAVIGATION
    window.addFlags(0x80000000); // FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      window.setNavigationBarContrastEnforced(false);
      window.setStatusBarContrastEnforced(false);
    }

    decorView.setBackgroundColor(this.systemBarColor);

    View rootView = activity.findViewById(android.R.id.content);
    if (rootView != null) {
      rootView.setBackgroundColor(this.systemBarColor);
    }

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
      window.setStatusBarColor(this.systemBarColor);
      window.setNavigationBarColor(this.systemBarColor);
    }

    setStatusBarStyle(window);
    setNavigationBarStyle(window);
  }

  private void setStatusBarStyle(final Window window) {
    String themeType = theme.getType();
    View decorView = window.getDecorView();
    int uiOptions;
    int lightStatusBar;

    if (SDK_INT <= 30) {
      uiOptions = getDeprecatedSystemUiVisibility(decorView);
      lightStatusBar = deprecatedFlagUiLightStatusBar();

      if (themeType.equals("light")) {
        setDeprecatedSystemUiVisibility(decorView, uiOptions | lightStatusBar);
        return;
      }
      setDeprecatedSystemUiVisibility(decorView, uiOptions & ~lightStatusBar);
      return;
    }

    uiOptions = Objects.requireNonNull(
      decorView.getWindowInsetsController()
    ).getSystemBarsAppearance();
    lightStatusBar = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS;

    if (themeType.equals("light")) {
      decorView
        .getWindowInsetsController()
        .setSystemBarsAppearance(uiOptions | lightStatusBar, lightStatusBar);
      return;
    }

    decorView
      .getWindowInsetsController()
      .setSystemBarsAppearance(uiOptions & ~lightStatusBar, lightStatusBar);
  }

  private void setNavigationBarStyle(final Window window) {
    String themeType = theme.getType();
    View decorView = window.getDecorView();
    int uiOptions;
    int lightNavigationBar;

    if (SDK_INT <= 30) {
      uiOptions = getDeprecatedSystemUiVisibility(decorView);
      lightNavigationBar = View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;

      if (themeType.equals("light")) {
        setDeprecatedSystemUiVisibility(
          decorView,
          uiOptions | lightNavigationBar
        );
        return;
      }
      setDeprecatedSystemUiVisibility(
        decorView,
        uiOptions & ~lightNavigationBar
      );
      return;
    }

    uiOptions = Objects.requireNonNull(
      decorView.getWindowInsetsController()
    ).getSystemBarsAppearance();
    lightNavigationBar =
      WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;

    if (themeType.equals("light")) {
      decorView
        .getWindowInsetsController()
        .setSystemBarsAppearance(
          uiOptions | lightNavigationBar,
          lightNavigationBar
        );
      return;
    }

    decorView
      .getWindowInsetsController()
      .setSystemBarsAppearance(
        uiOptions & ~lightNavigationBar,
        lightNavigationBar
      );
  }

  private int deprecatedFlagUiLightStatusBar() {
    return View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
  }

  private int getDeprecatedSystemUiVisibility(View decorView) {
    return decorView.getSystemUiVisibility();
  }

  private void setDeprecatedSystemUiVisibility(View decorView, int visibility) {
    decorView.setSystemUiVisibility(visibility);
  }

  private void getCordovaIntent(CallbackContext callback) {
    Intent intent = activity.getIntent();
    if (isReservedAuthIntent(intent)) {
      callback.sendPluginResult(
        new PluginResult(PluginResult.Status.OK, new JSONObject())
      );
      return;
    }
    callback.sendPluginResult(
      new PluginResult(PluginResult.Status.OK, getIntentJson(intent))
    );
  }

  private void setIntentHandler(CallbackContext callback) {
    intentHandler = callback;
    PluginResult result = new PluginResult(PluginResult.Status.NO_RESULT);
    result.setKeepCallback(true);
    callback.sendPluginResult(result);
  }

  @Override
  public void onNewIntent(Intent intent) {
    if (isReservedAuthIntent(intent)) {
      return;
    }
    if (intentHandler != null) {
      PluginResult result = new PluginResult(
        PluginResult.Status.OK,
        getIntentJson(intent)
      );
      result.setKeepCallback(true);
      intentHandler.sendPluginResult(result);
    }
  }

  private boolean isReservedAuthIntent(Intent intent) {
    Uri data = intent != null ? intent.getData() : null;
    if (data == null || !"acode".equals(data.getScheme())) {
      return false;
    }
    String host = data.getHost();
    String path = data.getPath();
    return "auth".equals(host) && "/callback".equals(path);
  }

  private JSONObject getIntentJson(Intent intent) {
    JSONObject json = new JSONObject();
    try {
      json.put("action", intent.getAction());
      json.put("data", intent.getDataString());
      json.put("type", intent.getType());
      json.put("package", intent.getPackage());
      json.put("uris", getIntentUris(intent));
      json.put("extras", getExtrasJson(intent.getExtras()));
    } catch (JSONException | RuntimeException e) {
      e.printStackTrace();
    }
    return json;
  }

  private JSONArray getIntentUris(Intent intent) {
    Set<Uri> uris = new LinkedHashSet<>();
    String action = intent.getAction();
    if (Intent.ACTION_VIEW.equals(action) || Intent.ACTION_EDIT.equals(action)) {
      if (intent.getData() != null) uris.add(intent.getData());
    } else if (!Intent.ACTION_SEND.equals(action) && !Intent.ACTION_SEND_MULTIPLE.equals(action)) {
      return new JSONArray();
    }
    try {
      Object stream = intent.getExtras() == null ? null : intent.getExtras().get(Intent.EXTRA_STREAM);
      if (stream instanceof Uri) uris.add((Uri) stream);
      else if (stream instanceof ArrayList<?>) {
        for (Object item : (ArrayList<?>) stream) {
          if (item instanceof Uri) uris.add((Uri) item);
        }
      }
    } catch (RuntimeException error) {
      Log.w(TAG, "Unable to read shared streams", error);
    }
    ClipData clip = intent.getClipData();
    if (clip != null) {
      for (int i = 0; i < clip.getItemCount(); i++) {
        Uri uri = clip.getItemAt(i).getUri();
        if (uri != null) uris.add(uri);
      }
    }
    JSONArray result = new JSONArray();
    for (Uri uri : uris) {
      if (!"content".equals(uri.getScheme()) && !"file".equals(uri.getScheme())) continue;
      result.put(uri.toString());
      int grants = intent.getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
      if ("content".equals(uri.getScheme()) && grants != 0 &&
          (intent.getFlags() & Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION) != 0) {
        try {
          context.getContentResolver().takePersistableUriPermission(uri, grants);
        } catch (SecurityException | IllegalArgumentException ignored) {
          // Temporary access remains valid when a provider cannot persist the grant.
        }
      }
    }
    return result;
  }

  private JSONObject getExtrasJson(Bundle extras) {
    JSONObject json = new JSONObject();
    if (extras != null) {
      for (String key : extras.keySet()) {
        try {
          Object value = extras.get(key);
          if (value instanceof String) {
            json.put(key, (String) value);
          } else if (value instanceof Integer) {
            json.put(key, (Integer) value);
          } else if (value instanceof Long) {
            json.put(key, (Long) value);
          } else if (value instanceof Double) {
            json.put(key, (Double) value);
          } else if (value instanceof Float) {
            json.put(key, (Float) value);
          } else if (value instanceof Boolean) {
            json.put(key, (Boolean) value);
          } else if (value instanceof Bundle) {
            json.put(key, getExtrasJson((Bundle) value));
          } else if (value != null) {
            json.put(key, value.toString());
          }
        } catch (JSONException e) {
          e.printStackTrace();
        }
      }
    }
    return json;
  }

  private Uri getContentProviderUri(String fileUri) {
    return this.getContentProviderUri(fileUri, "");
  }

  private Uri getContentProviderUri(String fileUri, String filename) {
    if (fileUri == null || fileUri.isEmpty()) {
      return null;
    }

    Uri uri = Uri.parse(fileUri);
    if (uri == null) {
      return null;
    }

    if ("file".equalsIgnoreCase(uri.getScheme())) {
      File originalFile = new File(uri.getPath());
      if (!originalFile.exists()) {
        Log.e("System", "File does not exist for URI: " + fileUri);
        return null;
      }

      String authority = getFileProviderAuthority();
      if (authority == null) {
        Log.e("System", "No FileProvider authority available.");
        return null;
      }

      try {
        return FileProvider.getUriForFile(context, authority, originalFile);
      } catch (IllegalArgumentException | SecurityException ex) {
        try {
          File cacheCopy = ensureShareableCopy(originalFile, filename);
          return FileProvider.getUriForFile(context, authority, cacheCopy);
        } catch (Exception copyError) {
          Log.e("System", "Failed to expose file via FileProvider", copyError);
          return null;
        }
      }
    }
    return uri;
  }

  private File ensureShareableCopy(File source, String displayName)
    throws IOException {
    File cacheRoot = new File(context.getCacheDir(), "shared");
    if (!cacheRoot.exists() && !cacheRoot.mkdirs()) {
      throw new IOException("Unable to create shared cache directory");
    }

    if (displayName != null && !displayName.isEmpty()) {
      displayName = new File(displayName).getName();
    }
    if (displayName == null || displayName.isEmpty()) {
      displayName = source.getName();
    }
    if (displayName == null || displayName.isEmpty()) {
      displayName = "shared-file";
    }

    File target = new File(cacheRoot, displayName);
    target = ensureUniqueFile(target);
    copyFile(source, target);
    return target;
  }

  private File ensureUniqueFile(File target) {
    if (!target.exists()) {
      return target;
    }

    String name = target.getName();
    String prefix = name;
    String suffix = "";
    int dotIndex = name.lastIndexOf('.');
    if (dotIndex > 0) {
      prefix = name.substring(0, dotIndex);
      suffix = name.substring(dotIndex);
    }

    int index = 1;
    File candidate = target;
    while (candidate.exists()) {
      candidate = new File(
        target.getParentFile(),
        prefix + "-" + index + suffix
      );
      index++;
    }
    return candidate;
  }

  private void copyFile(File source, File destination) throws IOException {
    try (
      InputStream in = new FileInputStream(source);
      OutputStream out = new FileOutputStream(destination)
    ) {
      byte[] buffer = new byte[8192];
      int length;
      while ((length = in.read(buffer)) != -1) {
        out.write(buffer, 0, length);
      }
      out.flush();
    }
  }

  private void grantUriPermissions(Intent intent, Uri uri, int flags) {
    if (uri == null) return;
    PackageManager pm = context.getPackageManager();
    List<ResolveInfo> resInfoList = pm.queryIntentActivities(
      intent,
      PackageManager.MATCH_DEFAULT_ONLY
    );
    for (ResolveInfo resolveInfo : resInfoList) {
      String packageName = resolveInfo.activityInfo.packageName;
      context.grantUriPermission(packageName, uri, flags);
    }
  }

  private String resolveMimeType(String currentMime, Uri uri, String filename) {
    if (
      currentMime != null &&
      !currentMime.isEmpty() &&
      !currentMime.equals("*/*")
    ) {
      return currentMime;
    }

    String mime = null;
    if (uri != null) {
      mime = context.getContentResolver().getType(uri);
    }

    if ((mime == null || mime.isEmpty()) && filename != null) {
      mime = getMimeTypeFromExtension(filename);
    }

    if ((mime == null || mime.isEmpty()) && uri != null) {
      String path = uri.getPath();
      if (path != null) {
        mime = getMimeTypeFromExtension(path);
      }
    }

    return (mime != null && !mime.isEmpty()) ? mime : "*/*";
  }

  /**
   * Picks the MIME type to advertise for a whole set of files.
   *
   * A multi-file send carries a single type, so reusing the first file's type
   * would advertise image/png for a PNG+PDF pair and let Android offer
   * image-only receivers that cannot open the PDF. The set's common type is
   * used instead, widened to a top-level wildcard such as image/&#42; when the
   * files share a top-level type, and to the universal wildcard otherwise.
   */
  private String resolveCommonMimeType(
    String requestedMime,
    List<Uri> uris,
    String filename
  ) {
    if (isExplicitMimeType(requestedMime)) {
      return requestedMime;
    }

    if (uris == null || uris.isEmpty()) {
      return resolveMimeType(requestedMime, null, filename);
    }

    if (uris.size() == 1) {
      return resolveMimeType(requestedMime, uris.get(0), filename);
    }

    String common = null;

    for (int i = 0; i < uris.size(); i++) {
      // The display name describes the primary file only.
      String type = mimeTypeOf(uris.get(i), i == 0 ? filename : "");

      if (type == null) {
        return "*/*";
      }

      if (common == null) {
        common = type;
        continue;
      }

      if (common.equalsIgnoreCase(type)) {
        continue;
      }

      String commonTop = topLevelMimeType(common);
      String typeTop = topLevelMimeType(type);

      if (commonTop == null || !commonTop.equalsIgnoreCase(typeTop)) {
        return "*/*";
      }

      common = commonTop + "/*";
    }

    return common == null ? "*/*" : common;
  }

  /**
   * Resolves one URI's MIME type without throwing.
   *
   * @return the type, or null when it cannot be determined.
   */
  private String mimeTypeOf(Uri uri, String filenameHint) {
    if (uri != null) {
      try {
        String type = context.getContentResolver().getType(uri);
        if (isConcreteMimeType(type)) {
          return type;
        }
      } catch (RuntimeException error) {
        Log.w(TAG, "Unable to read MIME type for " + uri, error);
      }
    }

    if (filenameHint != null && !filenameHint.isEmpty()) {
      String type = getMimeTypeFromExtension(filenameHint);
      if (isConcreteMimeType(type)) {
        return type;
      }
    }

    if (uri != null) {
      String path = uri.getPath();
      if (path != null) {
        String type = getMimeTypeFromExtension(path);
        if (isConcreteMimeType(type)) {
          return type;
        }
      }
    }

    return null;
  }

  /**
   * True when the caller supplied a real MIME type.
   *
   * An explicit value always wins, including application/octet-stream, because
   * the receiver may accept only that. Only the universal wildcard is treated
   * as "caller has no preference".
   */
  private static boolean isExplicitMimeType(String mimeType) {
    return (
      mimeType != null && !mimeType.isEmpty() && !"*/*".equals(mimeType)
    );
  }

  /**
   * Treats catch-all and octet-stream answers as "unknown" for types we detect
   * ourselves, otherwise every unresolved file would appear to share a type.
   * Caller-supplied types are judged by {@link #isExplicitMimeType} instead.
   */
  private static boolean isConcreteMimeType(String type) {
    return (
      type != null &&
      !type.isEmpty() &&
      !"*/*".equals(type) &&
      !"application/octet-stream".equals(type)
    );
  }

  private static String topLevelMimeType(String mimeType) {
    if (mimeType == null) {
      return null;
    }

    int slash = mimeType.indexOf('/');
    return slash > 0 ? mimeType.substring(0, slash) : null;
  }

  private String getFileProviderAuthority() {
    if (fileProviderAuthority != null && !fileProviderAuthority.isEmpty()) {
      return fileProviderAuthority;
    }

    try {
      PackageManager pm = context.getPackageManager();
      PackageInfo packageInfo = pm.getPackageInfo(
        context.getPackageName(),
        PackageManager.GET_PROVIDERS
      );
      if (packageInfo.providers != null) {
        for (ProviderInfo providerInfo : packageInfo.providers) {
          if (
            providerInfo != null &&
            providerInfo.name != null &&
            providerInfo.name.equals(FileProvider.class.getName())
          ) {
            fileProviderAuthority = providerInfo.authority;
            break;
          }
        }
      }
    } catch (PackageManager.NameNotFoundException error) {
      Log.w(
        TAG,
        "Unable to inspect package providers for FileProvider authority.",
        error
      );
    }

    if (fileProviderAuthority == null || fileProviderAuthority.isEmpty()) {
      fileProviderAuthority = context.getPackageName() + ".provider";
    }

    return fileProviderAuthority;
  }

  private boolean isPackageInstalled(
    String packageName,
    PackageManager packageManager,
    CallbackContext callback
  ) {
    try {
      packageManager.getPackageInfo(packageName, 0);
      return true;
    } catch (PackageManager.NameNotFoundException e) {
      return false;
    }
  }

  private void getGlobalSetting(String setting, CallbackContext callback) {
    int value = (int) Global.getFloat(
      context.getContentResolver(),
      setting,
      -1
    );
    callback.success(value);
  }

  private void clearCache(CallbackContext callback) {
    webView.clearCache(true);
    callback.success("Cache cleared");
  }

  private void setInputType(String type) {
    int mode = -1;
    if (type.equals("NO_SUGGESTIONS")) {
      mode = 0;
    } else if (type.equals("NO_SUGGESTIONS_AGGRESSIVE")) {
      mode = 1;
    }
    webView.setInputType(mode);
  }

  private void setNativeContextMenuDisabled(boolean disabled) {
    if (webView == null) {
      return;
    }
    webView.setNativeContextMenuDisabled(disabled);
  }

  /**
   * Dynamically changes the app icon by toggling activity-alias components.
   *
   * <p>The launcher icon is always represented by an activity-alias (including
   * the default icon) so that the running MainActivity component never has to
   * be disabled. Disabling the currently running component would make Android
   * force-stop/restart the app, so only aliases are toggled here.
   *
   * @param iconName Icon id (e.g. "midnight_circuit") or "default" to restore
   *     the original launcher icon.
   * @param callback Callback invoked with the result.
   */
  private void setAppIcon(String iconName, CallbackContext callback) {
    try {
      String packageName = context.getPackageName();
      PackageManager pm = context.getPackageManager();
      String key = iconName == null ? "default" : iconName.toLowerCase();

      String targetAlias = APP_ICON_ALIASES.get(key);
      if (targetAlias == null) {
        callback.error("Unknown app icon: " + iconName);
        return;
      }

      pm.setComponentEnabledSetting(
        new ComponentName(packageName, packageName + "." + targetAlias),
        PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
        PackageManager.DONT_KILL_APP
      );

      for (Map.Entry<String, String> entry : APP_ICON_ALIASES.entrySet()) {
        if (entry.getKey().equals(key)) {
          continue;
        }
        pm.setComponentEnabledSetting(
          new ComponentName(packageName, packageName + "." + entry.getValue()),
          PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
          PackageManager.DONT_KILL_APP
        );
      }
      callback.success();
    } catch (Exception e) {
      callback.error(e.toString());
    }
  }

  private void extractAsset(
    String assetName,
    String destinationPath,
    CallbackContext callback
  ) {
    try (
      InputStream in = context.getAssets().open(assetName);
      OutputStream out = new FileOutputStream(destinationPath)
    ) {
      byte[] buffer = new byte[8192];
      int length;
      while ((length = in.read(buffer)) != -1) {
        out.write(buffer, 0, length);
      }
      out.flush();
      callback.success();
    } catch (IOException e) {
      StringWriter sw = new StringWriter();
      e.printStackTrace(new PrintWriter(sw));
      callback.error(sw.toString());
    }
  }
}

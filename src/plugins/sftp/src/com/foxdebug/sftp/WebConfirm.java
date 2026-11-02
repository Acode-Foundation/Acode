package com.foxdebug.sftp;

import android.app.Activity;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.util.Log;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;
import org.apache.cordova.CallbackContext;
import org.apache.cordova.CordovaWebView;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Asks the page for a yes/no answer and waits for it.
 *
 * Prompts run in the WebView rather than as platform dialogs: Acode sets
 * `colorAccent` to `#FFFFFF`, so Android dialog buttons are drawn white on
 * white, and they sit behind the WebView where taps do not reach them.
 *
 * The bridge is: native calls `window.__acodeSftpConfirm(request)`, the page
 * answers with `sftp.resolveConfirmation(id, confirmed)`.
 */
final class WebConfirm {

  private static final String TAG = "SFTP";
  private static final String SERVICE = "Sftp";
  private static final long TIMEOUT_MS = 120000L;

  /** A prompt with no answer yet, keyed by request id. */
  private final Map<String, Consumer<Object>> pending = new ConcurrentHashMap<>();
  private final CordovaWebView webView;
  private final Activity activity;

  WebConfirm(CordovaWebView webView, Activity activity) {
    this.webView = webView;
    this.activity = activity;
  }

  /**
   * Show a confirmation and block until it is answered.
   *
   * Blocking is deliberate: the caller needs the answer to decide whether a
   * connection may proceed, so it cannot continue on a callback.
   *
   * @param title heading
   * @param message body text, newlines preserved
   * @param acceptLabel label for the confirming button
   * @return true when the person confirmed
   */
  boolean ask(String title, String message, String acceptLabel)
    throws InterruptedException {
    if (activity == null || activity.isFinishing()) return false;

    CountDownLatch decision = new CountDownLatch(1);
    AtomicBoolean confirmed = new AtomicBoolean(false);

    Consumer<Object> answer = (result) -> {
      confirmed.set(
        result instanceof JSONObject &&
        ((JSONObject) result).optBoolean("confirmed", false)
      );
      decision.countDown();
    };

    try {
      show(title, message, acceptLabel, answer);
    } catch (RuntimeException e) {
      Log.w(TAG, "Could not show the confirmation", e);
      decision.countDown();
    }

    // A prompt lost to a configuration change must not wedge the connection.
    if (!decision.await(TIMEOUT_MS, TimeUnit.MILLISECONDS)) {
      Log.w(TAG, "Confirmation timed out: " + title);
      return false;
    }
    return confirmed.get();
  }

  /**
   * Receive the page's answer to a prompt.
   * @param args `[requestId, confirmed]`
   */
  void resolve(JSONArray args, CallbackContext callback) {
    String requestId = args.optString(0);
    Consumer<Object> waiting = pending.remove(requestId);
    if (waiting == null) {
      callback.error("Unknown confirmation request");
      return;
    }

    JSONObject result = new JSONObject();
    try {
      result.put("confirmed", args.optBoolean(1, false));
    } catch (JSONException e) {
      // Read as "no" by the caller.
    }
    waiting.accept(result);
    callback.success();
  }

  /**
   * Release every waiting prompt, so a connection blocked on one finishes when
   * the page goes away.
   */
  void releaseAll() {
    for (Consumer<Object> waiting : pending.values()) waiting.accept(null);
    pending.clear();
  }

  private void show(
    String title,
    String message,
    String acceptLabel,
    Consumer<Object> onResult
  ) {
    if (webView == null) throw new IllegalStateException("WebView is not ready");

    String requestId = "sftp-confirm-" + UUID.randomUUID();
    pending.put(requestId, onResult);

    JSONObject request = new JSONObject();
    try {
      request.put("id", requestId);
      request.put("title", title);
      request.put("message", message);
      request.put("acceptLabel", acceptLabel);
      request.put("cancelLabel", "Cancel");
    } catch (JSONException e) {
      pending.remove(requestId);
      throw new IllegalStateException("Could not build the confirmation", e);
    }

    // Base64: the payload carries a fingerprint and free text, which must not
    // be spliced into a javascript: URL verbatim.
    String encoded = Base64.encodeToString(
      request.toString().getBytes(StandardCharsets.UTF_8),
      Base64.NO_WRAP
    );
    String fail =
      "function(){cordova.exec(null,null,'" +
      SERVICE +
      "','resolveConfirmation',['" +
      requestId +
      "',false]);}";
    String script =
      "javascript:(function(){" +
      "var fail=" +
      fail +
      ";" +
      "if(!window.__acodeSftpConfirm){fail();return;}" +
      "try{window.__acodeSftpConfirm(JSON.parse(" +
      "decodeURIComponent(escape(window.atob('" +
      encoded +
      "')))));}catch(e){fail();}" +
      "})()";

    new Handler(Looper.getMainLooper()).post(
      () -> {
        try {
          webView.loadUrl(script);
        } catch (RuntimeException e) {
          Log.e(TAG, "Could not dispatch the confirmation", e);
          Consumer<Object> waiting = pending.remove(requestId);
          if (waiting != null) waiting.accept(null);
        }
      }
    );
  }
}
